'use strict';

const DbClient = require('./db-client');
const UUID = require('./uuid');
const util = require('util');

/* ========================================================================== *
 * INDEX ERROR, WHEN DUPLICATES ARE FOUND                                     *
 * ========================================================================== */

class IndexError extends Error {
  constructor(scope, owner, duplicates) {
    var message = `Duplicate values indexing attributes for "${owner}" in scope "${scope}"`;
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
};

IndexError.prototype.message = 'Index Error';
IndexError.prototype.name = 'IndexError';

/* ========================================================================== *
 * DB INDEX CLASS                                                             *
 * ========================================================================== */

var instances = new WeakMap();

class DbIndex {
  constructor(tableName, client) {

    // Validate table name and key manager
    if (!util.isString(tableName)) throw new Error('Table name must be a string');
    if (!tableName.match(/^\w+$/)) throw new Error(`Invalid table name ${tableName}`);

    // Access to our database (RO/RW)
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    instances.set(this, {
      SELECT_SQL: `SELECT "owner" FROM "${tableName}" WHERE "scope" = $1::uuid AND "value" = $2::uuid`,
      INSERT_SQL: `INSERT INTO "${tableName}" ("scope", "owner", "value") VALUES `,
      DELETE_SQL: `DELETE FROM "${tableName}" WHERE "scope" = $1::uuid AND "owner" = $2::uuid`,
      client: client
    });
  }

  /* ------------------------------------------------------------------------ *
   * Index the attributes in the given scope, associating them with the owner *
   * ------------------------------------------------------------------------ */
  index(scope, owner, attributes, query) {
    var inst = instances.get(this);
    var self = this;

    // Execute DELETE/INSERT in a transaction
    if (! query) return inst.client.transaction(function(query) {
      return self.index(scope, owner, attributes, query);
    });

    // Delete all previously indexed values
    return query(inst.DELETE_SQL, scope, owner)
      .then(function() {
        var sql = [];
        var params = [];
        var values = {};

        // For each attribute, calculate its V5 UUID
        Object.keys(attributes).forEach(function (key) {
          var value = attributes[key];
          if (value != null) { // Null? Don't index!
            var value = values[key] = UUID.v5(scope, key + ":" + attributes[key]);
            var scope_pos = params.push(scope);
            var owner_pos = params.push(owner);
            var value_pos = params.push(value);
            sql.push(`($${scope_pos}::uuid, $${owner_pos}::uuid, $${value_pos}::uuid)`);
          }
        });

        // No parameters? Do nothing...
        if (params.length == 0) return {};

        // Check for existing indexed values
        var keys = Object.keys(values);
        var promises = [];

        // Shortcut w/o using "find", as we already have V5 UUIDs
        keys.forEach(function(key) {
          promises.push(query(inst.SELECT_SQL, scope, values[key])
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return null;
              return result.rows[0].owner;
            }));
        })

        // Wait for all promises to resolve
        return Promise.all(promises)
          .then(function(results) {

            // Check for duplicates
            var duplicates = {};
            var duplicates_found = false;
            for (var i = 0; i < promises.length; i++) {
              if (results[i] == null) continue;
              duplicates[keys[i]] = results[i];
              duplicates_found = true;
            }

            // Duplicates found? Foobar the entire thing!
            if (duplicates_found) throw new IndexError(scope, owner, duplicates);

            // Coast is clear, just insert...
            return query(inst.INSERT_SQL + sql.join(', '), params)
          })
          .then(function() {
            // Return map of { attribute --> v5 uuid }
            return values;
          })
      })
  }

  /* ------------------------------------------------------------------------ *
   * Find any owner matching the specified attribute in the given scope       *
   * ------------------------------------------------------------------------ */
  find(scope, key, value, query) {
    var inst = instances.get(this);
    var self = this;

    // Empty array for invalud UUIDs
    scope = UUID.validate(scope);
    if (! scope) return Promise.resolve(null);

    // Connect to the DB if not already
    if (! query) return inst.client.connect(function(query) {
      return self.find(scope, key, value, query);
    });

    // Wrap into a promise
    return new Promise(function(resolve, reject) {
        var sql = [];
        var parameters = [];

        // Calculate the attribute V5 UUID
        var uuid = UUID.v5(scope, key + ":" + value);

        // Insert our indexable values...
        resolve(query(inst.SELECT_SQL, scope, uuid)
          .then(function(result) {
            if ((! result) || (! result.rows) || (! result.rows[0])) return null;
            return result.rows[0].owner;
          }));
    });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbIndex;
