'use strict';

const DbClient = require('./db-client');
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

const SELECT_SQL = 'SELECT "owner" FROM "objects_index" WHERE COALESCE("scope", uuid_nil()) = $1::uuid AND "value" = $2::uuid';
const SCOPED_SQL = 'SELECT DISTINCT("owner") FROM "objects_index" WHERE COALESCE("scope", uuid_nil()) = $1::uuid';
const INSERT_SQL = 'INSERT INTO "objects_index" ("scope", "owner", "value") VALUES ';
const DELETE_SQL = 'DELETE FROM "objects_index" WHERE COALESCE("scope", uuid_nil()) = $1::uuid AND "owner" = $2::uuid';
const CLIENT = Symbol('client');

class DbIndex {
  constructor(client) {
    if (!(client instanceof DbClient)) {
      throw new Error('Database client not specified or invalid');
    }
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
        // Null scope is 000000.....
        var ns = scope || nil;

        var sql = [];
        var keys = [];
        var params = [];
        var values = {};
        var promises = [];


        // For each attribute, calculate its V5 UUID
        Object.keys(attributes).forEach(function (key) {
          var value = attributes[key];
          if (value != null) { // Null? Don't index!
            var value = values[key] = UUID.v5(ns, key + ":" + attributes[key]);
            var scope_pos = params.push(scope); // scope (nullable) not 0000...
            var owner_pos = params.push(owner);
            var value_pos = params.push(value);
            sql.push(`($${scope_pos}::uuid, $${owner_pos}::uuid, $${value_pos}::uuid)`);

            keys.push(key);
            promises.push(query(SELECT_SQL, ns, values[key])
              .then(function(result) {
                if ((! result) || (! result.rows) || (! result.rows[0])) return null;
                return result.rows[0].owner;
              }));
          }
        });

        // No parameters? Do nothing...
        if (params.length == 0) return {};

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
            return query(INSERT_SQL + sql.join(', '), params)
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
    var self = this;

    // NULL for invalud UUIDs
    scope = scope ? UUID.validate(scope) : nil;
    if (! scope) return Promise.resolve(null);

    // Connect to the DB if not already
    if (! query) return self[CLIENT].read(function(query) {
      return self.find(scope, key, value, query);
    });

    // Wrap into a promise
    return new Promise(function(resolve, reject) {

        // Calculate the attribute V5 UUID
        var uuid = UUID.v5(scope, key + ":" + value);

        // Insert our indexable values...
        resolve(query(SELECT_SQL, scope, uuid)
          .then(function(result) {
            if ((! result) || (! result.rows) || (! result.rows[0])) return null;
            return result.rows[0].owner;
          }));
    });
  }

  /* ------------------------------------------------------------------------ *
   * Find any owner in the given scope                                        *
   * ------------------------------------------------------------------------ */
  scoped(scope, query) {
    var self = this;

    // Empty array for invalud UUIDs
    scope = scope ? UUID.validate(scope) : nil;
    if (! scope) return Promise.resolve([]);

    // Connect to the DB if not already
    if (! query) return self[CLIENT].read(function(query) {
      return self.scoped(scope, query);
    });

    // Wrap into a promise
    return new Promise(function(resolve, reject) {

        // Insert our indexable values...
        resolve(query(SCOPED_SQL, scope)
          .then(function(result) {
            if ((! result) || (! result.rows) || (! result.rows[0])) return [];
            var owners = [];
            result.rows.forEach(function(row) {
              owners.push(row.owner);
            })
            return owners;
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

    return query(DELETE_SQL, scope || nil, owner)
      .then(function() {});
  }

}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

DbIndex.IndexError = IndexError;
exports = module.exports = DbIndex;
