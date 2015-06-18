'use strict';

const KeyManager = require('./key-manager');
const DbClient = require('./client');
const DbObject = require('./db-object');
const UUID = require('../uuid');

const EventEmitter = require('events').EventEmitter;
const util = require('util');

// Symbols for our private properties
const KEY_MANAGER = Symbol('key_manager');
const VALIDATE = Symbol('validate');
const CLIENT = Symbol('client');
const INDEX = Symbol('index');

/* ========================================================================== */

// Merge a couple of objects
function merge(one, two) {
  if (! util.isObject(one)) throw new Error('First object to merge not an object');
  if (! util.isObject(two)) throw new Error('Second object to merge not an object');

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
  });

  // Wipe out all null and empty string results
  Object.keys(result).forEach(function(key) {
    var value = result[key];
    if ((value == null) || (util.isString(value) && value.match(/^\s+$/))) {
      delete result[key];
    }
  });

  // Done!
  return result;
}

// Get the UUID string from a DBObject, string, or UUID
function getUuid(what) {
  if (! what) return null;
  if (what instanceof DbObject) return UUID.validate(what.uuid);
  if (what instanceof UUID) return what.toString();
  if (util.isString(what)) return UUID.validate(what);
  return null;
}

/* ========================================================================== *
 * DB STORE CLASS                                                             *
 * ========================================================================== */

class Store extends EventEmitter {
  constructor(keyManager, client, validator, indexer) {
    super();

    // Validate key manager
    if (! (keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    // Access to our database (RO/RW)
    if (! (client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Check validator
    var validate;
    if (! validator) {
      validate = function(object) {
        return Promise.resolve(object);
      };
    } else if (typeof(validator) === 'function') {
      validate = function(attributes, query, parent) {
        try {
          var result = validator(attributes, query, parent);
          if (! result) return Promise.resolve(attributes);
          if (util.isFunction(result.then)) return result;
          return Promise.resolve(result);
        } catch (error) {
          return Promise.reject(error);
        }
      };
    } else {
      throw new Error('Validator must be a function or null');
    }

    // Check indexer
    var index = null;
    if (! indexer) {
      index = function() {
        return Promise.resolve(null);
      };
    } else if (util.isFunction(indexer)) {
      index = function(attributes, query, object) {
        try {
          var result = indexer(attributes, query, object);
          if (util.isFunction(result.then)) return result;
          return Promise.resolve(result);
        } catch (error) {
          return Promise.reject(error);
        }
      };
    } else {
      throw new Error('Indexer must be a function or null');
    }

    /* ---------------------------------------------------------------------- *
     * Remember our instance variables                                        *
     * ---------------------------------------------------------------------- */

    // TODO: fixme!
    this.client = client;

    this[KEY_MANAGER] = keyManager;
    this[VALIDATE] = validate;
    this[CLIENT] = client;
    this[INDEX] = index;
  }

  /* ------------------------------------------------------------------------ *
   * Select a single record out of the DB                                     *
   * ------------------------------------------------------------------------ */

  select(uuid, includeDeleted, query) {
    var self = this;

    // Null for invalid UUIDs
    uuid = getUuid(uuid);
    if (! uuid) return Promise.resolve(null);

    // Check for optional parameters
    if (util.isFunction(includeDeleted)) {
      query = includeDeleted;
      includeDeleted = false;
    }

    // No query? Connect for "SELECT" (no updates)
    if (! query) {
      return self[CLIENT].read(function(read) {
        return self.select(uuid, includeDeleted, read);
      });
    }

    // Our basic SQL
    var sql = 'SELECT * FROM "'
            + (includeDeleted ? 'available_objects' : 'objects' )
            + '" WHERE "uuid" = $1::uuid';

    // Insert the SQL and invoke
    return query(sql, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return new DbObject(result.rows[0], self[KEY_MANAGER]);
      });
  }

  /* ------------------------------------------------------------------------ *
   * Find all records having the specified parent                             *
   * ------------------------------------------------------------------------ */

  parent(parent, kind, includeDeleted, query) {
    var self = this;

    // Null for invalid UUIDs
    parent = getUuid(parent);
    if (! parent) return Promise.resolve({});

    // Check for optional parameters
    if (util.isFunction(kind)) {
      query = kind;
      includeDeleted = false;
      kind = null;
    } else if (util.isBoolean(kind)) {
      query = includeDeleted;
      includeDeleted = kind;
      kind = null;
    } else if (util.isFunction(includeDeleted)) {
      query = includeDeleted;
      includeDeleted = false;
    }

    // No query? Connect for "SELECT" (no updates)
    if (! query) {
      return self[CLIENT].read(function(read) {
        return self.parent(parent, kind, includeDeleted, read);
      });
    }

    // Our basic SQL
    var sql = 'SELECT * FROM "'
            + (includeDeleted ? 'available_objects' : 'objects' )
            + '" WHERE "parent" = $1::uuid';
    var args = [ parent ];

    // Optional kind
    if (kind != null) {
      sql += ' AND "kind" = $2::kind';
      args.push(kind);
    }

    // Insert the SQL and invoke
    return query(sql, args)
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

    if (! query) {
      return self[CLIENT].transaction(function(transaction) {
        return self.insert(kind, parent, attributes, transaction);
      });
    }

    // Wrap in a promise, for exceptions
    return Promise.resolve(attributes)

      // Merge with empty (IOW copy) and validate
      .then(function(resolved) {
        var merged = merge({}, resolved);
        return self[VALIDATE](merged, query, parent);
      })

      // Encrypt attributes
      .then(function(validated) {
        return self[KEY_MANAGER].encrypt(validated);
      })

      // Insert into the DB
      .then(function(encrypted) {

        var sql = 'INSERT INTO "objects" '
                + '("kind", "parent", "encryption_key", "encrypted_data") VALUES'
                + '($1::kind, $2::uuid, $3::uuid, $4::bytea) RETURNING *';

        // Validate parent UUID
        var uuid = parent;
        if (uuid != null) {
          uuid = getUuid(parent);
          if (uuid == null) {
            throw new Error('Invalid parent "' + parent + '"');
          }
        }

        return query(sql, kind, uuid, encrypted.key, encrypted.data);
      })

      // Wrap the DB returned row
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        var object = new DbObject(result.rows[0], self[KEY_MANAGER]);

        // Decrypt (triple check)
        return object.attributes()
          .then(function(decrypted) {
            return self[INDEX](decrypted, query, object);
          })
          .then(function() {
            return object;
          });
      });
  }

  /* ------------------------------------------------------------------------ *
   * Update an existing record in the DB                                      *
   * ------------------------------------------------------------------------ */

  update(uuid, attributes, query) {
    var self = this;

    if (! query) {
      return self[CLIENT].transaction(function(transaction) {
        return self.update(uuid, attributes, transaction);
      });
    }

    // Attempt to get the record
    return self.select(uuid, query)
      .then(function(existing) {

        // Return null instead of throwing (send 404 at the end rather than 500)
        if (! existing) return null;

        // Decrypt the attributes in a sub-promise
        return existing.attributes()

          // Merge, then validate the new attributes
          .then(function(previous) {
            var merged = merge(previous, attributes);
            return self[VALIDATE](merged, query, existing.parent);
          })

          // Encrypt the new attributes
          .then(function(validated) {
            return self[KEY_MANAGER].encrypt(validated);
          })

          // Insert into the database
          .then(function(encrypted) {

            var sql = 'UPDATE "objects" SET '
                    + '"encryption_key" = $2::uuid, '
                    + '"encrypted_data" = $3::bytea '
                    + 'WHERE "uuid" = $1::uuid RETURNING *';

            return query(sql, uuid, encrypted.key, encrypted.data)
              .then(function(result) {
                if ((! result) || (! result.rows) || (! result.rows[0])) return null;
                var object = new DbObject(result.rows[0], self[KEY_MANAGER]);

                // Decrypt (triple check)
                return object.attributes()
                  .then(function(decrypted) {
                    return self[INDEX](decrypted, query, object);
                  })
                  .then(function() {
                    return object;
                  });
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
    uuid = getUuid(uuid);
    if (! uuid) return Promise.resolve(null);

    if (! query) {
      return self[CLIENT].write(function(write) {
        return self.delete(uuid, write);
      });
    }

    return query('DELETE FROM "objects" WHERE "uuid" = $1::uuid', uuid)
      .then(function() {
        return self.select(uuid, true, query);
      });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = Store;
