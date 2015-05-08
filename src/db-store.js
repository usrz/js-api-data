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
    this.domain = row.domain;
    this.created_at = row.created_at || null;
    this.updated_at = row.updated_at || null;
    this.deleted_at = row.deleted_at || null;
    this.attributes = attributes;
  }
}

/* ========================================================================== *
 * DB STORE CLASS                                                             *
 * ========================================================================== */
class DbStore {
  constructor(tableName, keyManager, roClient, rwClient) {

    // Validate table name and key manager
    if (!util.isString(tableName)) throw new Error('Table name must be a string');
    if (!tableName.match(/^\w+$/)) throw new Error(`Invalid table name ${tableName}`);
    if (!(keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    // Access to our database (RO/RW)
    if (!(roClient instanceof DbClient)) {
      throw new Error('Read-Only database client not specified or invalid');
    }

    // Read-write client, default to RO if unspecified
    if (!rwClient) {
      rwClient = roClient;
    } else if (!(rwClient instanceof DbClient)) {
      throw new Error('Read-Write database client is invalid');
    }

    // Expose clients to users
    this.roClient = roClient;
    this.rwClient = rwClient;

    // Our SQL statements
    const SELECT_SQL = `SELECT * FROM "${tableName}" WHERE "uuid" = $1::uuid`;
    const DOMAIN_SQL = `SELECT * FROM "${tableName}" WHERE "domain" = $1::uuid`;
    const INSERT_SQL = `INSERT INTO "${tableName}" ("domain", "encryption_key", "encrypted_data") VALUES ($1::uuid, $2::uuid, $3::bytea) RETURNING *`;
    const UPDATE_SQL = `UPDATE "${tableName}" SET "encryption_key" = $2::uuid, "encrypted_data" = $3::bytea WHERE "uuid" = $1::uuid RETURNING *`;
    const DELETE_SQL = `UPDATE "${tableName}" SET "deleted_at" = NOW() WHERE "uuid" = $1::uuid RETURNING *`;

    // This instance
    var self = this;

    /* ---------------------------------------------------------------------- *
     * "Private" utility methods to encrypt, decrypt, and validate uuids      *
     * ---------------------------------------------------------------------- */

    function encrypt(attributes) {
      return keyManager.get().then(function(encryption_key) {
        if (encryption_key == null) throw new Error('No encryption key available');
        return encryption_key.encrypt(attributes);
      });
    }

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

    function validate(uuid) {
      try {
        return Promise.resolve(UUID(uuid).toString());
      } catch (error) {
        return Promise.resolve(null);
      }
    }

    /* ---------------------------------------------------------------------- *
     * Check whether the specified uuid is valid                              *
     * ---------------------------------------------------------------------- */

    this.exists = function exists(uuid, include_deleted, query) {

      // Check for optional parameters
      if (typeof(include_deleted) === 'function') {
        query = include_deleted;
        include_deleted = false;
      }

      if (! query) return roClient.connect(function(query) {
        return self.exists(uuid, include_deleted, query);
      });

      return validate(uuid)
        .then(function(uuid) {
          if (! uuid) return false;

          var sql = DOMAIN_SQL;
          if (! include_deleted) sql += ' AND deleted_at IS NULL';

          return query(sql, uuid)
            .then(function(result) {
              return (result && result.rows && result.rows[0]);
            });
        })
    }

    /* ---------------------------------------------------------------------- *
     * Select a single record out of the DB                                   *
     * ---------------------------------------------------------------------- */

    this.select = function select(uuid, include_deleted, query) {

      // Check for optional parameters
      if (typeof(include_deleted) === 'function') {
        query = include_deleted;
        include_deleted = false;
      }

      if (! query) return roClient.connect(function(query) {
        return self.select(uuid, include_deleted, query);
      });

      return validate(uuid)
        .then(function(uuid) {
          if (! uuid) return null;

          var sql = DOMAIN_SQL;
          if (! include_deleted) sql += ' AND deleted_at IS NULL';

          return query(sql, uuid)
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return null;
              return decrypt(result.rows[0]);
            });
        })
    }

    /* ---------------------------------------------------------------------- *
     * Select all rows associated with a domain                               *
     * ---------------------------------------------------------------------- */

    this.domain = function domain(uuid, include_deleted, limit, query) {

      // Check for optional parameters
      if (typeof(include_deleted) === 'number') {
        query = limit;
        limit = include_deleted;
        include_deleted = false;
      } else if (typeof(include_deleted) === 'function') {
        query = include_deleted;
        include_deleted = false;
        limit = -1;
      }

      if (typeof(limit) === 'function') {
        query = limit;
        limit = -1;
      }

      // Normalize missing values
      include_deleted = include_deleted || false;
      limit = parseInt(limit) || -1;

      // If still no query, re-run with a default one!
      if (! query) return roClient.connect(function(query) {
        return self.domain(uuid, include_deleted, limit, query);
      });

      return validate(uuid)
        .then(function(uuid) {
          if (! uuid) return [];

          var sql = DOMAIN_SQL;
          if (! include_deleted) sql += ' AND deleted_at IS NULL';
          if (limit > 1) sql += ' LIMIT ' + parseInt(limit);

          return query(sql, uuid)
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return [];
              var results = [];
              for (var i in result.rows) results.push(result.rows[i].uuid);
              return results;
            });
        })
    }

    /* ---------------------------------------------------------------------- *
     * Insert a new record in the DB                                          *
     * ---------------------------------------------------------------------- */

    this.insert = function insert(domain, attributes, query) {
      if (! query) return rwClient.connect(function(query) {
        return self.insert(domain, attributes, query);
      });

      return encrypt(attributes)
        .then(function(encrypted) {
          return query(INSERT_SQL, domain, encrypted.key, encrypted.data)
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return null;
              return decrypt(result.rows[0]); // triple-check decryption
            });
        });
    }

    /* ---------------------------------------------------------------------- *
     * Update an existing record in the DB                                    *
     * ---------------------------------------------------------------------- */

    this.update = function update(uuid, attributes, query) {
      if (! query) return rwClient.connect(function(query) {
        return self.update(uuid, attributes, query);
      });

      return validate(uuid)
        .then(function(uuid) {
          if (! uuid) return null;

          return self.select(uuid, query)
            .then(function(result) {
              if (! result) return null;;

              // Merge and encrypt...
              return encrypt(merge(result.attributes, attributes))
                .then(function(encrypted) {
                  return query(UPDATE_SQL, uuid, encrypted.key, encrypted.data)
                    .then(function(result) {
                      if ((! result) || (! result.rows) || (! result.rows[0])) return null;
                      return decrypt(result.rows[0]); // triple-check decryption
                    });
                });
            });
        });
    }

    /* ---------------------------------------------------------------------- *
     * Soft delete from the DB and return old record                          *
     * ---------------------------------------------------------------------- */
    this.delete = function delete_(uuid, query) {
      if (! query) return rwClient.connect(function(query) {
        return self.delete(uuid, query);
      });

      return validate(uuid)
        .then(function(uuid) {
          if (! uuid) return null;

          return query(DELETE_SQL, uuid)
            .then(function(result) {
              if ((! result) || (! result.rows) || (! result.rows[0])) return null;
              return decrypt(result.rows[0]);
            });
        });
    }
  }
}


exports = module.exports = DbStore;
