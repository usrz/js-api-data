'use strict';

const KeyManager = require('./key-manager');
const DbClient = require('./db-client');
const UUID = require('./uuid');

const util = require('util');

// Merge a couple of objects (for updates)
function merge(one, two) {
  if (!util.isObject(one)) throw new Error('First object to merge not an object');
  if (!util.isObject(two)) throw new Error('Second object to merge not an object');

  var result = {};

  // Copy keys from first object
  Object.keys(one).forEach(function(key) {
    result[key] = one[key];
  });

  // Deep merge or override from second
  Object.keys(two).forEach(function(key) {
    if (util.isObject(result[key]) && util.isObject(two[key])) {
      result[key] = merge(result[key], two[key]);
    } else {
      result[key] = two[key];
    }
  })

  // Wipe out all null results
  Object.keys(result).forEach(function(key) {
    if (result[key] == null) delete result[key];
  })

  // Done!
  return result;
}

/* ========================================================================== *
 * DB OBJECT CLASS                                                            *
 * ========================================================================== */
class DbObject {
  constructor (row, attributes) {
    this.uuid = row.uuid;
    this.parent = row.parent;
    this.created_at = row.created_at || null;
    this.updated_at = row.updated_at || null;
    this.deleted_at = row.deleted_at || null;
    this.attributes = attributes;
  }
}

/* ========================================================================== *
 * DB STORE CLASS                                                             *
 * ========================================================================== */

var instances = new WeakMap();

class DbStore {
  constructor(tableName, keyManager, client) {

    // Validate table name and key manager
    if (!util.isString(tableName)) throw new Error('Table name must be a string');
    if (!tableName.match(/^\w+$/)) throw new Error(`Invalid table name ${tableName}`);
    if (!(keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    // Access to our database (RO/RW)
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Our SQL statements
    const SELECT_SQL = `SELECT * FROM "${tableName}" WHERE "uuid" = $1::uuid`;
    const PARENT_SQL = `SELECT * FROM "${tableName}" WHERE "parent" = $1::uuid`;
    const INSERT_SQL = `INSERT INTO "${tableName}" ("parent", "encryption_key", "encrypted_data") VALUES ($1::uuid, $2::uuid, $3::bytea) RETURNING *`;
    const UPDATE_SQL = `UPDATE "${tableName}" SET "encryption_key" = $2::uuid, "encrypted_data" = $3::bytea WHERE "uuid" = $1::uuid RETURNING *`;
    const DELETE_SQL = `UPDATE "${tableName}" SET "deleted_at" = NOW() WHERE "uuid" = $1::uuid RETURNING *`;

    /* ---------------------------------------------------------------------- *
     * Utility methods to decrypt (nice errors), find (for select, exists)    *
     * ---------------------------------------------------------------------- */

     // Decrypt with nice messages
    function decrypt(row) {
      return Promise.resolve(row)
        .then(function(row) {
          if (! row) throw new Error('No row to decrypt');
          if (! row.uuid) throw new Error('Unknown record uuid to decrypt');
          if (! row.encryption_key) throw new Error(`No encryption key for "${row.uuid}"`);
          return keyManager.get(row.encryption_key);
        })
        .then(function(encryption_key) {
          if (encryption_key == null) {
            throw new Error(`Key "${row.encryption_key}" unavailable for "${row.uuid}" in table "${tableName}"`);
          }
          return new DbObject(row, encryption_key.decrypt(row.encrypted_data));
        });
    }

     // Find a DB row, used by select and exists below
    var self = this;
    function find(uuid, include_deleted, query) {

      // Null for invalid UUIDs
      uuid = UUID.validate(uuid);
      if (! uuid) return Promise.resolve(null);

      // Check for optional parameters
      if (typeof(include_deleted) === 'function') {
        query = include_deleted;
        include_deleted = false;
      }

      // No query? Connect for "SELECT" (no updates)
      if (! query) return client.connect(false, function(query) {
        return find(uuid, include_deleted, query);
      });

      // Execute our SQL
      var sql = instances.get(self).SELECT_SQL;
      if (! include_deleted) sql += ' AND deleted_at IS NULL';
      return query(sql, uuid);
    }

    // Remember our instance variables
    instances.set(this, {
      SELECT_SQL: `SELECT * FROM "${tableName}" WHERE "uuid" = $1::uuid`,
      PARENT_SQL: `SELECT * FROM "${tableName}" WHERE "parent" = $1::uuid`,
      INSERT_SQL: `INSERT INTO "${tableName}" ("parent", "encryption_key", "encrypted_data") VALUES ($1::uuid, $2::uuid, $3::bytea) RETURNING *`,
      UPDATE_SQL: `UPDATE "${tableName}" SET "encryption_key" = $2::uuid, "encrypted_data" = $3::bytea WHERE "uuid" = $1::uuid RETURNING *`,
      DELETE_SQL: `UPDATE "${tableName}" SET "deleted_at" = NOW() WHERE "uuid" = $1::uuid RETURNING *`,
      encrypt: keyManager.encrypt.bind(keyManager),
      decrypt: decrypt.bind(this),
      find: find.bind(this),
      client: client
    })
  }

  /* ---------------------------------------------------------------------- *
   * Check whether the specified uuid is valid (quick, no decryption)       *
   * ---------------------------------------------------------------------- */

  exists(uuid, include_deleted, query) {
    return instances.get(this).find(uuid, include_deleted, query)
      .then(function(result) {
        return (result && result.rows && result.rows[0]);
      });
  }

  /* ------------------------------------------------------------------------ *
   * Select a single record out of the DB                                     *
   * ------------------------------------------------------------------------ */

  select(uuid, include_deleted, query) {
    var inst = instances.get(this);
    return inst.find(uuid, include_deleted, query)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return inst.decrypt(result.rows[0]);
      });
  }

  /* ------------------------------------------------------------------------ *
   * Find all records having the specified parent                             *
   * ------------------------------------------------------------------------ */

  parent(uuid, include_deleted, query) {
    var inst = instances.get(this);
    var self = this;

    // Null for invalid UUIDs
    uuid = UUID.validate(uuid);
    if (! uuid) return Promise.resolve(null);

    // Check for optional parameters
    if (typeof(include_deleted) === 'function') {
      query = include_deleted;
      include_deleted = false;
    }

    if (! query) return inst.client.connect(false, function(query) {
      return self.select(uuid, include_deleted, query);
    });

    var sql = inst.PARENT_SQL;
    if (! include_deleted) sql += ' AND deleted_at IS NULL';

    return query(sql, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return [];
        var promises = [];
        for (var i in result.rows) {
          promises.push(inst.decrypt(result.rows[i]));
        }
        return Promise.all(promises);
      });
  }

  /* ------------------------------------------------------------------------ *
   * Insert a new record in the DB                                            *
   * ------------------------------------------------------------------------ */

  insert(parent, attributes, query) {
    var inst = instances.get(this);
    var self = this;

    // Null for invalid UUIDs
    parent = UUID.validate(parent);
    if (! parent) return Promise.resolve(null);

    if (! query) return inst.client.connect(true, function(query) {
      return self.insert(parent, attributes, query);
    });

    return inst.encrypt(attributes)
      .then(function(encrypted) {
        return query(inst.INSERT_SQL, parent, encrypted.key, encrypted.data)
          .then(function(result) {
            if ((! result) || (! result.rows) || (! result.rows[0])) return null;
            return inst.decrypt(result.rows[0]); // triple-check decryption
          });
      });
  }

  /* ------------------------------------------------------------------------ *
   * Update an existing record in the DB                                      *
   * ------------------------------------------------------------------------ */

  update(uuid, attributes, query) {
    var inst = instances.get(this);
    var self = this;

    if (! query) return inst.client.connect(true, function(query) {
      return self.update(uuid, attributes, query);
    });

    return self.select(uuid, query)
      .then(function(result) {
        if (! result) return null;;

        // Merge and encrypt...
        return inst.encrypt(merge(result.attributes, attributes))
          .then(function(encrypted) {
            return query(inst.UPDATE_SQL, uuid, encrypted.key, encrypted.data)
              .then(function(result) {
                if ((! result) || (! result.rows) || (! result.rows[0])) return null;
                return inst.decrypt(result.rows[0]); // triple-check decryption
              });
          });
      });
  }

  /* ------------------------------------------------------------------------ *
   * Soft delete from the DB and return old record                            *
   * ------------------------------------------------------------------------ */
  delete(uuid, query) {
    var inst = instances.get(this);
    var self = this;

    // Null for invalid UUIDs
    uuid = UUID.validate(uuid);
    if (! uuid) return Promise.resolve(null);

    if (! query) return inst.client.connect(true, function(query) {
      return self.delete(uuid, query);
    });

    return query(inst.DELETE_SQL, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return inst.decrypt(result.rows[0]);
      });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbStore;
