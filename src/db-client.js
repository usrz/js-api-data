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

function DbError(message, cause, stack) {

  /* Build up our properties */
  Error.call(this, message);
  Error.captureStackTrace(this, DbError);

  /* Instrument the caller's stack */
  if (message) this.message = message;
  if (cause) this.cause = cause;
  mergeStack(this, cause);
};

DbError.prototype = Object.create(Error.prototype);
DbError.prototype.constructor = DbError;
DbError.prototype.message = 'Database Error';
DbError.prototype.name = 'DbError';

/* ========================================================================== *
 * DB CLIENT, POWER TO PROMISES                                               *
 * ========================================================================== */

function DbClient(uri) {
  if (!(this instanceof DbClient)) return new DbClient(uri);
  if (! uri) throw new DbError("DbClient connection URI not specified");

  var emitter = this.emit.bind(this);
  var emit = function emit() {
    try {
      emitter.apply(null, arguments);
    } catch (error) {
      console.warn("Error notifying listener", error.stack);
    }
  }
  this.emit = null;

  this.connect = function connect(callback) {

    return new Promise(function(resolve, reject) {
      pg.connect(uri, function(err, client, done) {
        if (err) {
          emit('error', err);
          return reject(new DbError('Error connecting to ' + uri, err));
        }

        // Emit our "connected"
        emit('acquired');

        // Our query function
        var query = function query(statement) {
          var parameters = Array.prototype.slice.call(arguments, 1);
          return new Promise(function(resolveQuery, rejectQuery) {
            client.query(statement, parameters, function(err, result) {
              if (err) {
                emit('error', err);
                var message = 'Error executing query "' + statement + '"';
                message += " with " + parameters.length + " parameters"
                for (var i = 0; i < parameters.length; i ++) {
                  message += "\n  - $" + i + " := " + util.inspect(parameters[i]);
                }
                return rejectQuery(new DbError(message, err));
              }

              emit('query', statement, parameters);
              resolveQuery(result);

            });
          });
        };

        // Callback must return a promise
        var promise = callback(query);
        if (typeof(promise.then) !== 'function') {
          promise = Promise.reject(new Error('Callback did not return a Promise'));
        }

        // Release connections when callback is done
        return promise
          .then(function(result) {
            done();
            emit('released');
            resolve(result);

          }, function(error) {
            done();
            emit('released');
            reject(error);
          });
      });
    });
  };

  this.query = function query(statement) {
    var self = this;
    var args = arguments;
    return this.connect(function(query) {
      return query.apply(self, args);
    });
  }

  this.transaction = function transaction(callback) {
    return this.connect(function(query) {
      return query('BEGIN')
        .then(function() {

          // Callback must return a promise
          var promise = callback(query);
          if (typeof(promise.then) !== 'function') {
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
}

// EventEmitter inheritance
util.inherits(DbClient, EventEmitter);

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbClient;

