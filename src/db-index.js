'use strict';

const KeyManager = require('./key-manager');
const DbClient   = require('./db-client');
const DbObject   = require('./db-object');
const UUID       = require('./uuid');
const util       = require('util');

/* ========================================================================== *
 * INDEX ERROR, WHEN DUPLICATES ARE FOUND                                     *
 * ========================================================================== */

class IndexError extends Error {
  constructor(scope, owner, duplicates) {
    var message = `Duplicate values indexing attributes for "${owner}" in `
                + (scope ? `scope "${scope}"` : 'NULL scope');
    for (var key in duplicates) message += `\n  "${key}" owned by "${duplicates[key]}"`;
    super(message);

    /* Remember our properties */
    this.duplicates = duplicates;
    this.message = message;
    this.scope = scope;
    this.owner = owner;

    /* Capture stack */
    Error.captureStackTrace(this, IndexError);
  };
}

IndexError.prototype.message = 'Index Error';
IndexError.prototype.name = 'IndexError';

/* ========================================================================== *
 * DB INDEX CLASS                                                             *
 * ========================================================================== */

const KEY_MANAGER = Symbol('key_manager');
const NAMESPACE   = Symbol('namespace');
const CLIENT      = Symbol('client');

class DbIndex {
  constructor(keyManager, client) {
    if (! (keyManager instanceof KeyManager)) throw new Error('Invalid key manager');
    if (! (client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Simple function to get namespace from scope
    this[NAMESPACE] = function namespace(scope) {
      if (scope == null) {
        return keyManager.namespace(UUID.NULL);
      } else if (util.isString(scope)) {
        return keyManager.namespace(scope);
      } else if (scope instanceof DbObject) {
        return keyManager.namespace(scope.uuid);
      } else {
        throw new Error('Scope must be a string or DbObject');
      }
    };

    // Key manager and client
    this[KEY_MANAGER] = keyManager;
    this[CLIENT] = client;
  }

  /* ------------------------------------------------------------------------ *
   * Index the attributes in the given scope, associating them with the owner *
   * ------------------------------------------------------------------------ */
  index(scope, owner, attributes, query) {
    var self = this;

    // Execute DELETE/INSERT in a transaction
    if (! query) {
      return self[CLIENT].transaction(function(transaction) {
        return self.index(scope, owner, attributes, transaction);
      });
    }

    // Delete all previously indexed values
    return this.clear(scope, owner, query)
      .then(function() {

        // Keys for duplicates, values to return
        var keys = {}, values = {}, empty = true;

        // Parameters for our insert and duples check query
        var dupParams = [], dupArgs = [];
        var insParams = [], insArgs = [];

        // Compute ths madness for each attribute
        Object.keys(attributes).forEach(function (key) {

          // Don't index null values
          if (attributes[key] == null) return;

          // Calculate the V5 UUID value to check as a duplicate,
          // then to be inserted in the db, and finally returned
          var namespace = self[NAMESPACE](scope);
          var keyid = UUID.v5(namespace, '' + key);
          var value = UUID.v5(namespace, '' + attributes[key]);
          values[key] = value;
          keys[value] = key;

          // Calculate arguments and parameters for the index insert query
          var scopePos = insParams.push(scope);
          var ownerPos = insParams.push(owner);
          var keyIdPos = insParams.push(keyid);
          var valuePos = insParams.push(value);
          insArgs.push(`($${scopePos}::uuid, $${ownerPos}::uuid,`
                     + ` $${keyIdPos}::uuid, $${valuePos}::uuid)`);

          // Then for the duplicates check query
          var checkPos = dupParams.push(value);
          dupArgs.push(`$${checkPos}::uuid`);

          // Finally, remember that we have to index
          empty = false;

        });

        // No parameters? Do nothing...
        if (empty) return {};

        // Build up our fancy query to find dupes
        var dupSql = 'SELECT "objects".*, "objects_index"."value"'
                     + ' FROM "objects_index", "objects"'
                    + ' WHERE "objects_index"."owner" = "objects"."uuid" AND'
                          + ' "objects_index"."value" IN (' + dupArgs.join(', ') + ') AND ';

        // Inject our scope in the SQL
        if (scope == null) {
          dupSql += '"objects_index"."scope" IS NULL';
        } else {
          var dupPos = dupParams.push(scope);
          dupSql += `"objects_index"."scope" = $${dupPos}::uuid`;
        }

        return query(dupSql, dupParams)
          .then(function(result) {

            // If we have some rows, we have dupes!
            if (result.rowCount > 0) {
              var duplicates = {};
              result.rows.forEach(function(row) {
                var previousOwner = new DbObject(row, self[KEY_MANAGER]);
                duplicates[keys[row.value]] = previousOwner;
              });
              throw new IndexError(scope, owner, duplicates);
            }

            // Well, good, no duplicates
            var insSql = 'INSERT INTO "objects_index" ("scope", "owner", "keyid", "value") '
                            + ' VALUES ' + insArgs.join(', ');

            return query(insSql, insParams)
              .then(function() {
                return values;
              });
          });
      });
  }

  /* ------------------------------------------------------------------------ *
   * Find all owners having the specified attribute indexed                   *
   * ------------------------------------------------------------------------ */
  search(scope, key, query) {
    var self = this;

    // Get the protected namespace
    var namespace;
    try {
      namespace = self[NAMESPACE](scope);
    } catch (error) {
      // Return null on invalid scopes
      return Promise.resolve(null);
    }

    // Connect to the DB if not already
    if (! query) {
      return self[CLIENT].read(function(read) {
        return self.search(scope, key, read);
      });
    }

    // Wrap into a promise
    return new Promise(function(resolve) {

        // Figure out how to query this puppy
        var sql = 'SELECT "objects".*'
                 + ' FROM "objects_index", "objects"'
                + ' WHERE "objects"."uuid" = "objects_index"."owner"'
                  + ' AND "keyid" = $1::uuid '
                  + ' AND "scope"';

        // Calculate the attribute V5 UUID
        var params = [ UUID.v5(namespace, key) ];

        // See about that NULL check
        if (scope) {
          sql += '= $2::uuid';
          params.push(scope);
        } else {
          sql += 'IS NULL';
        }

        // Let's see what we got...
        resolve(query(sql, params)
          .then(function(result) {
            var objects = [];
            if (result && result.rows) {
              result.rows.forEach(function(row) {
                objects.push(new DbObject(row, self[KEY_MANAGER]));
              });
            }
            return objects;
          }));
    });
  }

  /* ------------------------------------------------------------------------ *
   * Find any owner matching the specified attribute in the given scope       *
   * ------------------------------------------------------------------------ */
  find(scope, key, value, query) {
    var self = this;

    // Get the protected namespace
    var namespace;
    try {
      namespace = self[NAMESPACE](scope);
    } catch (error) {
      // Return null on invalid scopes
      return Promise.resolve(null);
    }

    // We never index NULL values
    if (value == null) return Promise.resolve(null);

    // Connect to the DB if not already
    if (! query) {
      return self[CLIENT].read(function(read) {
        return self.find(scope, key, value, read);
      });
    }

    // Wrap into a promise
    return new Promise(function(resolve) {

        // Figure out how to query this puppy
        var sql = 'SELECT "objects".*'
                 + ' FROM "objects_index", "objects"'
                + ' WHERE "objects"."uuid" = "objects_index"."owner"'
                  + ' AND "keyid" = $1::uuid '
                  + ' AND "value" = $2::uuid '
                  + ' AND "scope"';

        // Calculate the attribute V5 UUID
        var params = [ UUID.v5(namespace, '' + key),
                       UUID.v5(namespace, '' + value) ];

        // See about that NULL check
        if (scope) {
          sql += '= $3::uuid';
          params.push(scope);
        } else {
          sql += 'IS NULL';
        }

        // Let's see what we got...
        resolve(query(sql, params)
          .then(function(result) {
            if ((! result) || (! result.rows) || (! result.rows[0])) return null;
            return new DbObject(result.rows[0], self[KEY_MANAGER]);
          }));
    });
  }

  /* ------------------------------------------------------------------------ *
   * Clear (un/de-index) any value associated with the given scope and owner  *
   * ------------------------------------------------------------------------ */
  clear(scope, owner, query) {
    var self = this;

    // Connect to the DB if not already
    if (! query) {
      return self[CLIENT].transaction(function(transaction) {
        return self.clear(scope, owner, transaction);
      });
    }

    var params = [ owner ];
    var sql = 'DELETE FROM "objects_index"'
            + ' WHERE "owner" = $1::uuid AND "scope" ';
    if (scope) {
      sql += '= $2::uuid';
      params.push(scope);
    } else {
      sql += 'IS NULL';
    }

    return query(sql, params)
      .then(function() {});
  }

}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

DbIndex.IndexError = IndexError;
exports = module.exports = DbIndex;
