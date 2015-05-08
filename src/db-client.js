'use strict';

// Get our PG instance
const pg = (function() {
  var pg = null;
  try {
    pg = require('pg').native;
  } catch(error) {
    pg = require('pg');
  } finally {
    return pg || require('pg');
  }
})();

// EventEmitter and Utils from Node
const EventEmitter = require('events').EventEmitter;
const util = require('util');

// Merge stack trace from cause
function mergeStack(error, cause) {
  if (! cause) return;
  var stack = error.stack || error.toString();
  if (util.isError(cause)) {
    stack += '\n  Caused by ' + (cause.stack || cause.toString());
  } else {
    stack += '\n  Caused by [' + typeof(cause) + '] ' + cause.toString();
  }
  Object.defineProperty(error, 'stack', {
    enumerable: false,
    configurable: true, // leave configurable
    value: stack
  });
}

/* ========================================================================== *
 * DB ERROR, WRAPS ANOTHER ERROR NICELY                                       *
 * ========================================================================== */

class DbError extends Error {
  constructor(message, cause, stack) {
    super(message);

    /* Our properties */
    if (message) this.message = message;
    if (cause) this.cause = cause;

    /* Capture our stack trace and marge */
    Error.captureStackTrace(this, DbError);
    if (cause) mergeStack(this, cause);
  };
};

DbError.prototype.message = 'Database Error';
DbError.prototype.name = 'DbError';

/* ========================================================================== *
 * DB CLIENT, POWER TO PROMISES                                               *
 * ========================================================================== */

class DbClient extends EventEmitter {
  constructor(ro_uri, rw_uri) {
    super();

    if (! ro_uri) throw new DbError("DbClient connection URI not specified");
    if (! rw_uri) rw_uri = ro_uri;
    this.ro_uri = ro_uri;
    this.rw_uri = rw_uri;
  }

  /* ------------------------------------------------------------------------ *
   * Connect to the database, invoke callback with query fn, return Promise   *
   * ------------------------------------------------------------------------ */
  connect(updates, callback) {
    if (typeof(updates) === 'function') {
      callback = updates;
      updates = false;
    }

    var self = this;
    var uri = updates ? this.rw_uri : this.ro_uri;

    return new Promise(function(resolve, reject) {
      pg.connect(uri, function(err, client, done) {
        if (err) {
          self.emit('exception', err);
          return reject(new DbError('Error connecting to ' + uri, err));
        }

        // Emit our "connected"
        self.emit('acquired', uri);

        // Our query function
        var query = function query(statement) {
          var parameters = Array.prototype.slice.call(arguments, 1);
          return new Promise(function(resolveQuery, rejectQuery) {
            client.query(statement.toString(), parameters, function(err, result) {
              if (err) {
                self.emit('exception', err);
                var message = 'Error executing query "' + statement + '"';
                message += " with " + parameters.length + " parameters"
                for (var i = 0; i < parameters.length; i ++) {
                  message += "\n  - $" + i + " := " + util.inspect(parameters[i]);
                }
                message += "\n  - DB := " + uri;
                return rejectQuery(new DbError(message, err));
              }

              self.emit('query', statement, parameters);
              resolveQuery(result);

            });
          });
        };

        // Callback must return a promise
        var promise = callback(query);
        if ((! promise) || (typeof(promise.then) !== 'function')) {
          promise = Promise.reject(new Error('Callback did not return a Promise'));
        }

        // Release connections when callback is done
        return promise
          .then(function(result) {
            done();
            self.emit('released', uri);
            resolve(result);

          }, function(error) {
            done();
            self.emit('released', uri);
            reject(error);
          });
      });
    });
  };

  /* ------------------------------------------------------------------------ *
   * Wrap "connect" with "BEGIN" -> "COMMIT"/"ROLLBACK"                       *
   * ------------------------------------------------------------------------ */
  transaction(callback) {
    return this.connect(true, function(query) {
      return query('BEGIN')
        .then(function() {

          // Callback must return a promise
          var promise = callback(query);
          if ((! promise) || (typeof(promise.then) !== 'function')) {
            promise = Promise.reject(new Error('Callback did not return a promise'));
          }

          // Commit/rollback transaction when callback is done
          return promise
            .then(function(result) {
              return query('COMMIT')
                .then(function() {
                  return result;
                });
            }, function(error) {
              return query('ROLLBACK')
                .then(function() {
                  throw error
                });
            });
        });
    });
  };

  /* ------------------------------------------------------------------------ *
   * One-shot connect, single query, return Promise                           *
   * ------------------------------------------------------------------------ */
  query(updates, statement) {
    var self = this;
    var args = Array.prototype.slice.call(arguments, 0);
    if (typeof(updates) === 'boolean') {
      statement = args.splice(0, 1)[0];
    } else {
      updates = false;
    }
    return this.connect(updates, function(query) {
      return query.apply(self, args);
    });
  }

}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbClient;
