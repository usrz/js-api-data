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
  constructor(message, cause) {
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
 * Connect to the DB, execute query or callback, return Promise               *
 * ========================================================================== */

function connect(uri, callback) {
  if (!(this instanceof DbClient)) throw new Error('WRONG!');
  var self = this;

  if (util.isString(callback)) {
    var args = Array.prototype.slice.call(arguments, 1);
    return connect.call(this, uri, function(query) {
      return query.apply(self, args);
    });
  } else if (! util.isFunction(callback)) {
    return Promise.reject(new Error('Must be called with a string statement or callback function'));
  }

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
        var params = Array.prototype.slice.call(arguments, 1);
        if ((params.length == 1) && (Array.isArray(params[0]))) params = params[0];
        return new Promise(function(resolveQuery, rejectQuery) {
          client.query(statement.toString(), params, function(err, result) {
            if (err) {
              self.emit('exception', err);
              var message = 'Error executing query "' + statement + '"';
              message += " with " + params.length + " parameters"
              for (var i = 0; i < params.length; i ++) {
                message += "\n  - $" + i + " := " + util.inspect(params[i]);
              }
              message += "\n  - DB := " + uri;
              return rejectQuery(new DbError(message, err));
            }

            self.emit('query', statement, params);
            resolveQuery(result);

          });
        });
      }.bind(self);

      // Promise the callback
      var promise = null;
      try {
        promise = callback(query);
      } catch (error) {
        promise = Promise.reject(error);
      }

      // Callback must return a promise
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
   * One-shot connect, single query (or callback), return Promise             *
   * ------------------------------------------------------------------------ */

  read(statementOrCallback) {
    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(this.ro_uri); // open connection for reading
    return connect.apply(this, args);
  }

  write(statementOrCallback) {
    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(this.rw_uri); // open connection for writing
    return connect.apply(this, args);
  }

  /* ------------------------------------------------------------------------ *
   * Wrap "connect" with "BEGIN" -> "COMMIT"/"ROLLBACK"                       *
   * ------------------------------------------------------------------------ */

  transaction(callback) {

    // We only accept callbacks here!
    if (! util.isFunction(callback)) {
      return Promise.reject(new Error('Must be called with callback function'));
    }

    // Connect with the R/W uri (it's a transaction!)
    return connect.call(this, this.rw_uri, function(query) {
      return query('BEGIN')
        .then(function() {

          // Promise the callback
          var promise = null;
          try {
            promise = callback(query);
          } catch (error) {
            promise = Promise.reject(error);
          }

          // Callback must return a promise
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
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

DbClient.DbError = DbError;
exports = module.exports = DbClient;
