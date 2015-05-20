'use strict';

const KeyManager = require('./key-manager');
const Validator = require('./validator');
const DbClient = require('./db-client');
const UUID = require('./uuid');

const util = require('util');
const joi = require('joi');

// Symbols for our private properties
const ENCRYPTION_KEY = Symbol('encryption_key');
const ENCRYPTED_DATA = Symbol('encrypted_data');
const KEY_MANAGER    = Symbol('key_manager');
const SELECT_SQL     = Symbol('select_sql');
const PARENT_SQL     = Symbol('parent_sql');
const INSERT_SQL     = Symbol('insert_sql');
const UPDATE_SQL     = Symbol('update_sql');
const DELETE_SQL     = Symbol('delete_sql');
const VALIDATE       = Symbol('validate');
const CLIENT         = Symbol('client');

/* ========================================================================== *
 * DB OBJECT CLASS                                                            *
 * ========================================================================== */

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

    this[ENCRYPTION_KEY] = row.encryption_key;
    this[ENCRYPTED_DATA] = row.encrypted_data;
    this[KEY_MANAGER] = keyManager;
  }

  attributes() {
    var self = this;
    return self[KEY_MANAGER].get(self[ENCRYPTION_KEY])
      .then(function(decryption_key) {
        if (decryption_key != null) return decryption_key.decrypt(self[ENCRYPTED_DATA]);
        throw new Error(`Key "${self[ENCRYPTION_KEY]}" unavailable for "${self.uuid}"`);
      })

    return Promise.resolve(this.foo);
  }
}

/* ========================================================================== *
 * DB STORE CLASS                                                             *
 * ========================================================================== */

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
    else if ((typeof(validator) === 'object') && (validator.isJOI === true)) {
      validate = function(object) {
        // TODO!!!!
        var result = joi.validate(object, validator);
        if (result.error) throw result.error;
        return result.value;
      };
    } else throw new Error('Validator must be a function or Validator instance');

    /* ---------------------------------------------------------------------- *
     * Remember our instance variables                                        *
     * ---------------------------------------------------------------------- */

    this[KEY_MANAGER] = keyManager;
    this[SELECT_SQL] = `SELECT * FROM "${tableName}" WHERE "uuid" = $1::uuid`;
    this[PARENT_SQL] = `SELECT * FROM "${tableName}" WHERE "parent" = $1::uuid`;
    this[INSERT_SQL] = `INSERT INTO "${tableName}" ("parent", "encryption_key", "encrypted_data") VALUES ($1::uuid, $2::uuid, $3::bytea) RETURNING *`;
    this[UPDATE_SQL] = `UPDATE "${tableName}" SET "encryption_key" = $2::uuid, "encrypted_data" = $3::bytea WHERE "uuid" = $1::uuid RETURNING *`;
    this[DELETE_SQL] = `UPDATE "${tableName}" SET "deleted_at" = NOW() WHERE "uuid" = $1::uuid RETURNING *`;
    this[VALIDATE] = validate;
    this[CLIENT] = client;

  }

  /* ------------------------------------------------------------------------ *
   * Select a single record out of the DB                                     *
   * ------------------------------------------------------------------------ */

  select(uuid, include_deleted, query) {
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
    if (! query) return self[CLIENT].read(function(query) {
      return self.select(uuid, include_deleted, query);
    });

    // Execute our SQL
    var sql = self[SELECT_SQL];
    if (! include_deleted) sql += ' AND deleted_at IS NULL';

    return query(sql, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return new DbObject(result.rows[0], self[KEY_MANAGER]);
      });
  }

  /* ------------------------------------------------------------------------ *
   * Find all records having the specified parent                             *
   * ------------------------------------------------------------------------ */

  parent(uuid, include_deleted, query) {
    var self = this;

    // Null for invalid UUIDs
    uuid = UUID.validate(uuid);
    if (! uuid) return Promise.resolve(null);

    // Check for optional parameters
    if (typeof(include_deleted) === 'function') {
      query = include_deleted;
      include_deleted = false;
    }

    if (! query) return self[CLIENT].read(function(query) {
      return self.parent(uuid, include_deleted, query);
    });

    var sql = self[PARENT_SQL];
    if (! include_deleted) sql += ' AND deleted_at IS NULL';

    return query(sql, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return {};
        var objects = {};
        for (var i in result.rows) {
          var object = new DbObject(result.rows[i], self[KEY_MANAGER]);
          objects[object.uuid] = object;
        }
        return objects;
      });
  }

  /* ------------------------------------------------------------------------ *
   * Insert a new record in the DB                                            *
   * ------------------------------------------------------------------------ */

  insert(parent, attributes, query) {
    var self = this;

    // Null for invalid UUIDs
    parent = UUID.validate(parent);
    if (! parent) return Promise.resolve(null);

    if (! query) return self[CLIENT].write(function(query) {
      return self.insert(parent, attributes, query);
    });

    return new Promise(function (resolve, reject) {
      resolve(self[KEY_MANAGER].encrypt(self[VALIDATE](Validator.merge({}, attributes)))
        .then(function(encrypted) {
          return query(self[INSERT_SQL], parent, encrypted.key, encrypted.data)
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return null;
              return new DbObject(result.rows[0], self[KEY_MANAGER]);
            });
        }));
    });
  }

  /* ------------------------------------------------------------------------ *
   * Update an existing record in the DB                                      *
   * ------------------------------------------------------------------------ */

  update(uuid, attributes, query) {
    var self = this;

    if (! query) return self[CLIENT].write(function(query) {
      return self.update(uuid, attributes, query);
    });

    return self.select(uuid, query)
      .then(function(result) {
        if (! result) return null;

        // Resolve (decrypt) old attributes, merge, validate then encrypt...
        return result.attributes()
          .then(function(old_attr) {
            return self[KEY_MANAGER].encrypt(self[VALIDATE](Validator.merge(old_attr, attributes)))
          })
          .then(function(encrypted) {
            return query(self[UPDATE_SQL], uuid, encrypted.key, encrypted.data)
              .then(function(result) {
                if ((! result) || (! result.rows) || (! result.rows[0])) return null;
                return new DbObject(result.rows[0], self[KEY_MANAGER]);
              });
          });
      });
  }

  /* ------------------------------------------------------------------------ *
   * Soft delete from the DB and return old record                            *
   * ------------------------------------------------------------------------ */
  delete(uuid, query) {
    var self = this;

    // Null for invalid UUIDs
    uuid = UUID.validate(uuid);
    if (! uuid) return Promise.resolve(null);

    if (! query) return self[CLIENT].write(function(query) {
      return self.delete(uuid, query);
    });

    return query(self[DELETE_SQL], uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return new DbObject(result.rows[0], self[KEY_MANAGER]);
      });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbStore;
