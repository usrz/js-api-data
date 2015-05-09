'use strict';

const DbClient = require('./db-client');
const UUID = require('./uuid');
const util = require('util');

var instances = new WeakMap();

class DbIndex {
  constructor(tableName, client) {

    // Validate table name and key manager
    if (!util.isString(tableName)) throw new Error('Table name must be a string');
    if (!tableName.match(/^\w+$/)) throw new Error(`Invalid table name ${tableName}`);

    // Access to our database (RO/RW)
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    instances.set(this, {
      SELECT_SQL: `SELECT DISTINCT("owner") FROM "${tableName}" WHERE "value" IN `,
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
        var uuids = [];
        var parameters = [];

        // For each attribute, calculate its V5 UUID
        Object.keys(attributes).forEach(function (key) {
          var value = attributes[key];
          if (value != null) { // Null? Don't index!
            var value = UUID.v5(scope, key + ":" + attributes[key]);
            var scope_pos = parameters.push(scope);
            var owner_pos = parameters.push(owner);
            var value_pos = parameters.push(value);
            sql.push(`($${scope_pos}::uuid, $${owner_pos}::uuid, $${value_pos}::uuid)`);
            uuids.push(value);
          }
        });

        // No parameters? Do nothing...
        if (uuids.length == 0) return uuids;

        // Insert our indexable values...
        return query(inst.INSERT_SQL + sql.join(', '), parameters)
          .then(function() {
            return uuids;
          })
      })
  }

  /* ------------------------------------------------------------------------ *
   * Find any owner matching the specified attributes (OR) in the given scope *
   * ------------------------------------------------------------------------ */
  find(scope, attributes, query) {
    var inst = instances.get(this);
    var self = this;

    // Empty array for invalud UUIDs
    scope = UUID.validate(scope);
    if (! scope) return Promise.resolve([]);

    // Connect to the DB if not already
    if (! query) return inst.client.connect(function(query) {
      return self.find(scope, attributes, query);
    });

    // Wrap into a promise
    return new Promise(function(resolve, reject) {
        var sql = [];
        var parameters = [];

        // For each attribute, calculate its V5 UUID
        Object.keys(attributes).forEach(function (key) {
          var value = attributes[key];
          if (value != null) { // Null? Don't search!
            var value = UUID.v5(scope, key + ":" + attributes[key]);
            var param = parameters.push(value);
            sql.push('$' + param);
          }
        });

        // No parameters? Do nothing...
        if (parameters.length == 0) return [];

        // Insert our indexable values...
        resolve(query(inst.SELECT_SQL + '(' + sql.join(', ') + ')', parameters)
          .then(function(result) {
            if ((! result) || (! result.rows) || (! result.rows[0])) return [];
            var owners = [];
            for (var i in result.rows) owners.push(result.rows[i].owner);
            return owners;
          }));
    });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbIndex;
