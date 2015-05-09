'use strict';

const DbClient = require('./db-client');
const UUID = require('./uuid');
const util = require('util');

class DbIndex {
  constructor(tableName, client) {

    // Validate table name and key manager
    if (!util.isString(tableName)) throw new Error('Table name must be a string');
    if (!tableName.match(/^\w+$/)) throw new Error(`Invalid table name ${tableName}`);

    // Access to our database (RO/RW)
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Our SQL statements
    const SELECT_SQL = `SELECT DISTINCT("owner") FROM "${tableName}" WHERE "value" IN `
    const INSERT_SQL = `INSERT INTO "${tableName}" ("scope", "owner", "value") VALUES `;
    const DELETE_SQL = `DELETE FROM "${tableName}" WHERE "scope" = $1::uuid AND "owner" = $2::uuid`;

    // This instance
    var self = this;

    this.index = function index(scope, owner, attributes, query) {

      // Execute DELETE/INSERT in a transaction
      if (! query) return client.transaction(function(query) {
        return self.index(scope, owner, attributes, query);
      });

      // Delete all previously indexed values
      return query(DELETE_SQL, scope, owner)
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
          return query(INSERT_SQL + sql.join(', '), parameters)
            .then(function() {
              return uuids;
            })
        })
    }

    this.find = function find(scope, attributes, query) {

      // Empty array for invalud UUIDs
      try {
        scope = UUID(scope).toString();
      } catch (error) {
        return Promise.resolve([]);
      }

      // Connect to the DB if not already
      if (! query) return client.connect(function(query) {
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
          resolve(query(SELECT_SQL + '(' + sql.join(', ') + ')', parameters)
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return [];
              var owners = [];
              for (var i in result.rows) owners.push(result.rows[i].owner);
              return owners;
            }));
      });
    }

  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbIndex;
