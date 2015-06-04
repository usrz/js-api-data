'use strict';

const KeyManager = require('./key-manager');
const DbClient = require('./db-client');
const DbObject = require('./db-object');
const UUID = require('./uuid');

const EventEmitter = require('events').EventEmitter;
const util = require('util');

// Symbols for our private properties
const KEY_MANAGER    = Symbol('key_manager');
const VALIDATE       = Symbol('validate');
const CLIENT         = Symbol('client');
const INDEX          = Symbol('index');

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
function to_uuid(what) {
  if (! what) return null;
  if (what instanceof DbObject) return UUID.validate(what.uuid);
  if (what instanceof UUID) return uuid.toString();
  if (util.isString(what)) return UUID.validate(what);
  return null;
}

/* ========================================================================== *
 * DB STORE CLASS                                                             *
 * ========================================================================== */

class DbStore extends EventEmitter {
  constructor(keyManager, client, schema, indexer) {
    super();

    // Validate key manager
    if (!(keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    // Access to our database (RO/RW)
    if (!(client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Check schema
    var self = this;
    var validate;
    if (! schema) validate = function(object) { return Promise.resolve(object) };
    else if (typeof(schema) === 'function') {

      validate = function(attributes, query, parent) {
        try {
          var result = schema(attributes, query, parent);
          if (! result) return Promise.resolve(attributes);
          if (util.isFunction(result.then)) return result;
          return Promise.resolve(result);
        } catch (error) {
          return Promise.reject(error);
        }
      }

    }
    else throw new Error('Schema must be a validation function or Joi schema');

    //
    var index = null;
    if (! indexer) index = function() { return Promise.resolve(null) }
    else if (util.isFunction(indexer)) {
      index = function(attributes, query, object) {
        try {
          var result = indexer(attributes, query, object);
          if (util.isFunction(result.then)) return result;
          return Promise.resolve(result);
        } catch (error) {
          return Promise.reject(error);
        }
      }
    }
    else throw new Error("Sorry, matey!!!");

    /* ---------------------------------------------------------------------- *
     * Remember our instance variables                                        *
     * ---------------------------------------------------------------------- */

    this[KEY_MANAGER] = keyManager;
    this[VALIDATE] = validate;
    this[CLIENT] = client;
    this[INDEX] = index;

  }

  toString() {
    return "[object DbStore]";
  }

  /* ------------------------------------------------------------------------ *
   * Select a single record out of the DB                                     *
   * ------------------------------------------------------------------------ */

  select(uuid, kind, include_deleted, query) {
    var self = this;

    // Null for invalid UUIDs
    uuid = to_uuid(uuid);
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
    parent = to_uuid(parent);
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

    // Wrap in a promise, for exceptions
    return Promise.resolve(attributes)

      // Merge with empty (IOW copy) and validate
      .then(function(attributes) {
        var merged = merge({}, attributes);
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
          uuid = to_uuid(parent);
          if (uuid == null) {
            throw new Error('Invalid parent "' + parent + "'");
          }
        }

        return query(sql, kind, uuid, encrypted.key, encrypted.data);
      })

      // Wrap the DB returned row
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        var object = new DbObject(result.rows[0], self[KEY_MANAGER]);
        return object.attributes()
          .then(function(attributes) {
            return self[INDEX](attributes, query, object);
          })
          .then(function(whatever) {
            return object;
          })
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

    // Attempt to get the record
    return self.select(uuid, query)
      .then(function(result) {

        // Return null instead of throwing (send 404 at the end rather than 500)
        if (! result) return null;

        // Decrypt the attributes in a sub-promise
        return result.attributes()

          // Merge, then validate the new attributes
          .then(function(previous) {
            var merged = merge(previous, attributes);
            return self[VALIDATE](merged, query, result.parent);
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
                return object.attributes()
                  .then(function(attributes) {
                    return self[INDEX](attributes, query, object);
                  })
                  .then(function(whatever) {
                    return object;
                  })
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
    uuid = to_uuid(uuid);
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
 * "SIMPLE" STORE                                                             *
 * ========================================================================== */

class Simple {
  constructor(store, kind) {
    Object.defineProperties(this, {
      "client": { enumerable: false, configurable: false, value: store[CLIENT] },
      "store":  { enumerable: false, configurable: false, value: store },
      "kind":   { enumerable: false, configurable: false, value: kind  },
    });
  }

  get(uuid, include_deleted, query) {
    var self = this;

    // Optional parameter
    if (util.isFunction(include_deleted)) {
      query = include_deleted;
      include_deleted = false;
    }

    // Potentially, this might be called from a transaction
    if (! query) return this.client.read(function(query) {
      return self.store.select(uuid, self.kind, include_deleted, query);
    });

    return this.store.select(uuid, this.kind, include_deleted, query);
  }

  delete(uuid, query) {
    var self = this;

    // Execute all in a transaction (if one was not specified)
    if (! query) return this.client.transaction(function(query) {
      return self.store.delete(uuid, query);
    });

    return this.store.delete(uuid, query);
  }

  create(parent, attributes, query) {
    var self = this;

    // Execute all in a transaction (if one was not specified)
    if (! query) return this.client.transaction(function(query) {
      return self.store.insert(self.kind, parent, attributes, query);
    });

    return this.store.insert(this.kind, parent, attributes, query);
  }

  modify(uuid, attributes, query) {
    var self = this;

    // Execute all in a transaction (if one was not specified)
    if (! query) return this.client.transaction(function(query) {
      return self.store.update(uuid, attributes, query);
    });

    // Modify the user
    return this.store.update(uuid, attributes, query)
  }


}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

DbStore.Simple = Simple;
exports = module.exports = DbStore;
