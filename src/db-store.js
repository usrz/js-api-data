'use strict';

const KeyManager = require('./key-manager');
const Validator = require('./validator');
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

  // Wipe out all null and empty string results
  Object.keys(result).forEach(function(key) {
    var value = result[key];
    if ((value == null) || (util.isString(value) && value.match(/^\s+$/)))
      delete result[key];
  });

  // Done!
  return result;
}

/* ========================================================================== *
 * DB OBJECT CLASS                                                            *
 * ========================================================================== */
var objects = new WeakMap();

class DbObject {
  constructor (row, keyManager) {
    if (! row) throw new Error('No row for DB object');
    if (! row.uuid) throw new Error('No UUID for DB object');
    if (! row.parent) throw new Error('No parent UUID for DB object');

    this.uuid = row.uuid;
    this.parent = row.parent;
    this.created_at = row.created_at || null;
    this.updated_at = row.updated_at || null;
    this.deleted_at = row.deleted_at || null;

    objects.set(this, {
      encryption_key: row.encryption_key,
      encrypted_data: row.encrypted_data,
      key_manager: keyManager
    });
  }

  attributes() {
    var object = objects.get(this);
    var self = this;

    return object.key_manager.get(object.encryption_key)
      .then(function(encryption_key) {
        if (encryption_key != null) return encryption_key.decrypt(object.encrypted_data);
        throw new Error(`Key "${object.encryption_key}" unavailable for "${self.uuid}"`);
      })

    return Promise.resolve(this.foo);
  }
}

/* ========================================================================== *
 * DB STORE CLASS                                                             *
 * ========================================================================== */

var instances = new WeakMap();

class DbStore {
  constructor(tableName, keyManager, client, validator) {

    // Validate table name and key manager
    if (!util.isString(tableName)) throw new Error('Table name must be a string');
    if (!tableName.match(/^\w+$/)) throw new Error(`Invalid table name ${tableName}`);
    if (!(keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    // Access to our database (RO/RW)
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Check validator
    var validate;
    if (! validator) validate = function(object) { return object };
    else if (validator instanceof Validator) validate = validator.validate.bind(validator);
    else if (typeof(validator) === 'function') validate = validator;
    else throw new Error('Validator must be a function or Validator instance');

    /* ---------------------------------------------------------------------- *
     * Remember our instance variables                                        *
     * ---------------------------------------------------------------------- */

    instances.set(this, {
      SELECT_SQL: `SELECT * FROM "${tableName}" WHERE "uuid" = $1::uuid`,
      PARENT_SQL: `SELECT * FROM "${tableName}" WHERE "parent" = $1::uuid`,
      INSERT_SQL: `INSERT INTO "${tableName}" ("parent", "encryption_key", "encrypted_data") VALUES ($1::uuid, $2::uuid, $3::bytea) RETURNING *`,
      UPDATE_SQL: `UPDATE "${tableName}" SET "encryption_key" = $2::uuid, "encrypted_data" = $3::bytea WHERE "uuid" = $1::uuid RETURNING *`,
      DELETE_SQL: `UPDATE "${tableName}" SET "deleted_at" = NOW() WHERE "uuid" = $1::uuid RETURNING *`,
      keyManager: keyManager,
      //encrypt: keyManager.encrypt.bind(keyManager),
      //decrypt: decrypt.bind(this),
      validate: validate,
      client: client
    })
  }

  /* ------------------------------------------------------------------------ *
   * Select a single record out of the DB                                     *
   * ------------------------------------------------------------------------ */

  select(uuid, include_deleted, query) {
    var inst = instances.get(this);
    var self = this;

    // Check for optional "include_deleted"
    if (typeof(include_deleted) === 'function') {
      query = include_deleted;
      include_deleted = false;
    }

    // Null for invalid UUIDs
    uuid = UUID.validate(uuid);
    if (! uuid) return Promise.resolve(null);

    // No query? Connect for "SELECT" (no updates)
    if (! query) return inst.client.read(function(query) {
      return self.select(uuid, include_deleted, query);
    });

    // Execute our SQL
    var sql = instances.get(self).SELECT_SQL;
    if (! include_deleted) sql += ' AND deleted_at IS NULL';

    return query(sql, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return new DbObject(result.rows[0], inst.keyManager);
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

    if (! query) return inst.client.read(function(query) {
      return self.parent(uuid, include_deleted, query);
    });

    var sql = inst.PARENT_SQL;
    if (! include_deleted) sql += ' AND deleted_at IS NULL';

    return query(sql, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return [];
        var objects = [];
        for (var i in result.rows) {
          objects.push(new DbObject(result.rows[i], inst.keyManager));
        }
        return objects;
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

    if (! query) return inst.client.write(function(query) {
      return self.insert(parent, attributes, query);
    });

    return new Promise(function (resolve, reject) {
      resolve(inst.keyManager.encrypt(inst.validate(merge({}, attributes)))
        .then(function(encrypted) {
          return query(inst.INSERT_SQL, parent, encrypted.key, encrypted.data)
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return null;
              return new DbObject(result.rows[0], inst.keyManager);
            });
        }));
    });
  }

  /* ------------------------------------------------------------------------ *
   * Update an existing record in the DB                                      *
   * ------------------------------------------------------------------------ */

  update(uuid, attributes, query) {
    var inst = instances.get(this);
    var self = this;

    if (! query) return inst.client.write(function(query) {
      return self.update(uuid, attributes, query);
    });

    return self.select(uuid, query)
      .then(function(result) {
        if (! result) return null;

        // Resolve (decrypt) old attributes, merge, validate then encrypt...
        return result.attributes()
          .then(function(old_attr) {
            return inst.keyManager.encrypt(inst.validate(merge(old_attr, attributes)))
          })
          .then(function(encrypted) {
            return query(inst.UPDATE_SQL, uuid, encrypted.key, encrypted.data)
              .then(function(result) {
                if ((! result) || (! result.rows) || (! result.rows[0])) return null;
                return new DbObject(result.rows[0], inst.keyManager);
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

    if (! query) return inst.client.write(function(query) {
      return self.delete(uuid, query);
    });

    return query(inst.DELETE_SQL, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return new DbObject(result.rows[0], inst.keyManager);
      });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbStore;
