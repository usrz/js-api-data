'use strict';

const KeyManager = require('./key-manager');
const DbClient = require('./db-client');
const DbObject = require('./db-object');
const UUID = require('./uuid');
const util = require('util');

const nil = UUID.NULL.toString();

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
};

IndexError.prototype.message = 'Index Error';
IndexError.prototype.name = 'IndexError';

/* ========================================================================== *
 * DB INDEX CLASS                                                             *
 * ========================================================================== */

const KEY_MANAGER = Symbol('key_manager');
const CLIENT = Symbol('client');

class DbIndex {
  constructor(keyManager, client) {
    if (!(keyManager instanceof KeyManager)) throw new Error('Invalid key manager');
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    this[KEY_MANAGER] = keyManager;
    this[CLIENT] = client;
  }

  /* ------------------------------------------------------------------------ *
   * Index the attributes in the given scope, associating them with the owner *
   * ------------------------------------------------------------------------ */
  index(scope, owner, attributes, query) {
    var self = this;

    // Execute DELETE/INSERT in a transaction
    if (! query) return self[CLIENT].transaction(function(query) {
      return self.index(scope, owner, attributes, query);
    });

    // Delete all previously indexed values
    return this.clear(scope, owner, query)
      .then(function() {

        // Keys for duplicates, values to return
        var keys = {}, values = {}, empty = true;

        // Parameters for our insert and duples check query
        var dup_params = [], dup_args = [];
        var ins_params = [], ins_args = [];

        // Compute ths madness for each attribute
        Object.keys(attributes).forEach(function (key) {
          var value = attributes[key];

          // Don't index null values
          if (value == null) return;

          // Calculate the V5 UUID value to check as a duplicate,
          // then to be inserted in the db, and finally returned
          var value = UUID.v5(scope || nil, key + ":" + attributes[key]);
          values[key] = value;
          keys[value] = key;

          // Calculate arguments and parameters for the insert query
          var scope_pos = ins_params.push(scope);
          var owner_pos = ins_params.push(owner);
          var value_pos = ins_params.push(value);
          ins_args.push(`($${scope_pos}::uuid, $${owner_pos}::uuid, $${value_pos}::uuid)`);

          // Then for the duplicates check query
          var check_pos = dup_params.push(value);
          dup_args.push(`$${check_pos}::uuid`);

          // Finally, remember that we have to index
          empty = false;

        });

        // No parameters? Do nothing...
        if (empty) return {};

        // Build up our fancy query to find dupes
        var dup_sql = 'SELECT "objects".*, "objects_index"."value"'
                    +  ' FROM "objects_index", "objects"'
                    + ' WHERE "objects_index"."owner" = "objects"."uuid" AND'
                    +       ' "objects_index"."value" IN (' + dup_args.join(', ') + ') AND ';

        // Inject our scope in the SQL
        if (scope == null) {
          dup_sql += '"objects_index"."scope" IS NULL';
        } else {
          var dup_pos = dup_params.push(scope);
          dup_sql += `"objects_index"."scope" = $${dup_pos}::uuid`
        }

        return query(dup_sql, dup_params)
          .then(function(result) {

            // If we have some rows, we have dupes!
            if (result.rowCount > 0) {
              var duplicates = {};
              result.rows.forEach(function(row) {
                var previous_owner = new DbObject(row, self[KEY_MANAGER]);
                duplicates[keys[row.value]] = previous_owner;
              });
              throw new IndexError(scope, owner, duplicates);
            }

            // Well, good, no duplicates
            var ins_sql = 'INSERT INTO "objects_index" ("scope", "owner", "value") '
                        +     ' VALUES ' + ins_args.join(', ');

            return query(ins_sql, ins_params)
              .then(function() {
                return values;
              })
          })
      })
  }

  /* ------------------------------------------------------------------------ *
   * Find any owner matching the specified attribute in the given scope       *
   * ------------------------------------------------------------------------ */
  find(scope, key, value, query) {
    var self = this;

    // NULL for invalud UUIDs
    var namespace = scope ? UUID.validate(scope) : nil;
    if (! namespace) return Promise.resolve(null);

    // Connect to the DB if not already
    if (! query) return self[CLIENT].read(function(query) {
      return self.find(scope, key, value, query);
    });

    // Wrap into a promise
    return new Promise(function(resolve, reject) {

        // Figure out how to query this puppy
        var sql = 'SELECT "objects".* FROM "objects_index", "objects"'
                + ' WHERE "objects"."uuid" = "objects_index"."owner"'
                +   ' AND "value" = $1::uuid '
                +   ' AND "scope"';

        // Calculate the attribute V5 UUID
        var params = [ UUID.v5(namespace, key + ":" + value) ];

        // See about that NULL check
        if (scope) {
          sql += "= $2::uuid";
          params.push(scope);
        } else {
          sql += "IS NULL";
        }

        // Let's see what we get...
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
    if (! query) return self[CLIENT].write(function(query) {
      return self.clear(scope, owner, query);
    });

    var params = [ owner ];
    var sql = 'DELETE FROM "objects_index"'
            +      ' WHERE "owner" = $1::uuid'
            +        ' AND "scope" ';
    if (scope) {
      sql += "= $2::uuid";
      params.push(scope);
    } else {
      sql += "IS NULL";
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
