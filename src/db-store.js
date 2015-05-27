'use strict';

const KeyManager = require('./key-manager');
const DbClient = require('./db-client');
const DbObject = require('./db-object');
const UUID = require('./uuid');

const util = require('util');
const joi = require('joi');

// Symbols for our private properties
const KEY_MANAGER    = Symbol('key_manager');
const DELETE_SQL     = Symbol('delete_sql');
const VALIDATE       = Symbol('validate');
const CLIENT         = Symbol('client');

/* ========================================================================== */

// Merge a couple of objects
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

// Get the UUID string from a DBObject, string, or UUID
function validate(what) {
  if (! what) return null;
  if (what instanceof DbObject) return what.uuid;
  if (what instanceof UUID) return uuid.toString();
  if (util.isString(what)) return UUID.validate(what);
  return null;
}

/* ========================================================================== *
 * DB STORE CLASS                                                             *
 * ========================================================================== */

const HACK = 'domain';

class DbStore {
  constructor(keyManager, client, schema) {

    // Validate key manager
    if (!(keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    // Access to our database (RO/RW)
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Check schema
    var validate;
    if (! schema) validate = function(object) { return object };
    else if (typeof(schema) === 'function') validate = schema;
    else if ((typeof(schema) === 'object') && (schema.isJoi === true)) {
      validate = function(object) {
        var result = joi.validate(object, schema, {abortEarly: false});
        if (result.error) throw result.error;
        return result.value;
      };
    } else throw new Error('Schema must be a validation function or Joi schema');

    /* ---------------------------------------------------------------------- *
     * Remember our instance variables                                        *
     * ---------------------------------------------------------------------- */

    this[KEY_MANAGER] = keyManager;
    this[DELETE_SQL] = 'UPDATE "objects" SET "deleted_at" = NOW() WHERE "uuid" = $1::uuid RETURNING *';
    this[VALIDATE] = validate;
    this[CLIENT] = client;

  }

  /* ------------------------------------------------------------------------ *
   * Select a single record out of the DB                                     *
   * ------------------------------------------------------------------------ */

  select(uuid, kind, include_deleted, query) {
    var self = this;

    // Null for invalid UUIDs
    uuid = validate(uuid);
    if (! uuid) return Promise.resolve(null);

    // Check for optional parameters
    if (util.isFunction(kind)) {
      query = kind;
      include_deleted = false;
      kind = null;
    } else if (util.isBoolean(kind)) {
      query = include_deleted;
      include_deleted = kind;
      kind = null;
    } else if (util.isFunction(include_deleted)) {
      query = include_deleted;
      include_deleted = false;
    }

    // No query? Connect for "SELECT" (no updates)
    if (! query) return self[CLIENT].read(function(query) {
      return self.select(uuid, kind, include_deleted, query);
    });

    // Our basic SQL
    var sql = 'SELECT * FROM "'
            + (include_deleted ? 'available_objects' : 'objects' )
            + '" WHERE "uuid" = $1::uuid';
    var args = [ uuid ];

    // Optional kind
    if (kind != null) {
      sql += ' AND "kind" = $2::kind';
      args.push(kind);
    }

    // Insert the SQL and invoke
    args.unshift(sql);
    return query.apply(null, args)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return new DbObject(result.rows[0], self[KEY_MANAGER]);
      });
  }

  /* ------------------------------------------------------------------------ *
   * Find all records having the specified parent                             *
   * ------------------------------------------------------------------------ */

  parent(parent, kind, include_deleted, query) {
    var self = this;

    // Null for invalid UUIDs
    parent = validate(parent);
    if (! parent) return Promise.resolve({});

    // Check for optional parameters
    if (util.isFunction(kind)) {
      query = kind;
      include_deleted = false;
      kind = null;
    } else if (util.isBoolean(kind)) {
      query = include_deleted;
      include_deleted = kind;
      kind = null;
    } else if (util.isFunction(include_deleted)) {
      query = include_deleted;
      include_deleted = false;
    }

    // No query? Connect for "SELECT" (no updates)
    if (! query) return self[CLIENT].read(function(query) {
      return self.parent(parent, kind, include_deleted, query);
    });

    // Our basic SQL
    var sql = 'SELECT * FROM "'
            + (include_deleted ? 'available_objects' : 'objects' )
            + '" WHERE "parent" = $1::uuid';
    var args = [ parent ];

    // Optional kind
    if (kind != null) {
      sql += ' AND "kind" = $2::kind';
      args.push(kind);
    }

    // Insert the SQL and invoke
    args.unshift(sql);
    return query.apply(null, args)
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

  insert(kind, parent, attributes, query) {
    var self = this;

    if (! query) return self[CLIENT].write(function(query) {
      return self.insert(kind, parent, attributes, query);
    });

    return new Promise(function (resolve, reject) {
      resolve(self[KEY_MANAGER].encrypt(self[VALIDATE](merge({}, attributes)))
        .then(function(encrypted) {

          var sql = 'INSERT INTO "objects" '
                  + '("kind", "parent", "encryption_key", "encrypted_data") VALUES'
                  + '($1::kind, $2::uuid, $3::uuid, $4::bytea) RETURNING *';

          // Validate parent UUID
          var uuid = parent;
          if (uuid != null) {
            uuid = validate(parent);
            if (uuid == null) {
              throw new Error('Invalid parent "' + parent + "'");
            }
          }

          // Call the DB
          return query(sql, kind, uuid, encrypted.key, encrypted.data)
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
            return self[KEY_MANAGER].encrypt(self[VALIDATE](merge(old_attr, attributes)))
          })
          .then(function(encrypted) {

            var sql = 'UPDATE "objects" SET '
                    + '"encryption_key" = $2::uuid, '
                    + '"encrypted_data" = $3::bytea '
                    + 'WHERE "uuid" = $1::uuid RETURNING *';

            return query(sql, uuid, encrypted.key, encrypted.data)
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
    uuid = validate(uuid);
    if (! uuid) return Promise.resolve(null);

    if (! query) return self[CLIENT].write(function(query) {
      return self.delete(uuid, query);
    });

    return query('DELETE FROM "objects" WHERE "uuid" = $1::uuid', uuid)
      .then(function(result) {
        return self.select(uuid, null, true, query);
      });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbStore;
