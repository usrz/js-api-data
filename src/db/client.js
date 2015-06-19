'use strict';

// Get our PG instance
const pg = (function() {
  var client = null;
  try {
    client = require('pg').native;
  } catch(error) {
    client = require('pg');
  } finally {
    return client || require('pg');
  }
})();

// EventEmitter and Utils from Node
const EventEmitter = require('events').EventEmitter;
const ClientError = require('./client-error');
const util = require('util');

/* ========================================================================== *
 * DB CLIENT, POWER TO PROMISES                                               *
 * ========================================================================== */

class Client extends EventEmitter {
  constructor(roUri, rwUri) {
    super();

    if (! roUri) throw new ClientError('Client connection URI not specified');
    if (! rwUri) rwUri = roUri;
    this.ro_uri = roUri;
    this.rw_uri = rwUri;
  }

  /* ------------------------------------------------------------------------ *
   * One-shot connect, single query (or callback), return Promise             *
   * ------------------------------------------------------------------------ */

  read() {
    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(this.ro_uri); // open connection for reading
    return connect.apply(this, args);
  }

  write() {
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
                  throw error;
                });
            });
        });
    });
  }
}

/* ========================================================================== *
 * Connect to the DB, execute query or callback, return Promise               *
 * ========================================================================== */

function connect(uri, callback) {
  if (! (this instanceof Client)) throw new Error('WRONG!');
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
        return reject(new ClientError('Error connecting to ' + uri, err));
      }

      // Emit our "connected"
      self.emit('acquired', uri);

      // Our query function
      var query = function query(statement) {
        var params = Array.prototype.slice.call(arguments, 1);
        if ((params.length === 1) && (Array.isArray(params[0]))) params = params[0];
        return new Promise(function(resolveQuery, rejectQuery) {
          client.query(statement.toString(), params, function(error, result) {
            if (error) {
              self.emit('exception', error);
              var message = 'Error executing query "' + statement + '"';
              message += ' with ' + params.length + ' parameters';
              for (var i = 0; i < params.length; i ++) {
                message += '\n  - $' + i + ' := ' + util.inspect(params[i]);
              }
              message += '\n  - DB := ' + uri;
              return rejectQuery(new ClientError(message, error));
            }

            self.emit('query', statement, params);
            resolveQuery(result);

          });
        });
      };

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
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = Client;
