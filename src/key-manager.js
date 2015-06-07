'use strict';

const crypto = require('crypto');
const util = require('util');

const DbClient = require('./db-client');
const UUID = require('./uuid');

const INSERT_SQL = 'INSERT INTO "encryption_keys" ("encrypted_key") VALUES ($1::bytea) RETURNING *';
const SELECT_ALL_SQL = 'SELECT * FROM "encryption_keys"';
const SELECT_SQL = SELECT_ALL_SQL + ' WHERE "uuid"=$1::uuid';
const DELETE_SQL = 'UPDATE "encryption_keys" SET "deleted_at" = NOW() WHERE "uuid"=$1::uuid AND "deleted_at" IS NULL RETURNING *';

// v1 (buffer) v2 (string) v3 (json) encryption:
// - AES-256-GCM with AAD using Vx_TAG
// -- first byte is "0x01", "0x02" or "0x03" (the tag below)
// -- followed by 12 bytes of initialization vector
// -- followed by 16 bytes of authentication tag
// -- followed by N bytes (where N>1) of encrypted data
const V1_TAG = new Buffer([0x01]);
const V2_TAG = new Buffer([0x02]);
const V3_TAG = new Buffer([0x03]);

/* ========================================================================== *
 * OUR KEY CLASS (encrypts, decripts, hides key buffer)                       *
 * ========================================================================== */
const ENCRYPTION_KEY = Symbol('encryptionKey');

class Key {
  constructor(uuid, key, createdAt, deletedAt) {

    // Validate/normalize UUID
    this.uuid = UUID.validate(uuid);
    if (uuid == null) throw new Error('Invalid UUID for key ' + uuid);

    // Validate encryption key
    if (! util.isBuffer(key)) throw new Error('Encryption key is not a buffer');
    if (key.length !== 32) throw new Error('Encryption key must be 256 bits long');

    this[ENCRYPTION_KEY] = key;

    // Remember our created/deleted dates (if any)
    this.created_at = createdAt ? createdAt : new Date();
    this.deleted_at = deletedAt || null;

    // Freeze ourselves
    Object.freeze(this);
  }

  /* ------------------------------------------------------------------------ *
   * Encrypt some data with this key                                          *
   * ------------------------------------------------------------------------ */
  encrypt(data) {
    var key = this[ENCRYPTION_KEY];

    // Default, buffers
    var versionTag = V1_TAG;

    // Determine whatever we are given, is it a (non-buffer) Object?
    if ((! util.isBuffer(data)) && util.isObject(data)) {
      data = new Buffer(JSON.stringify(data), 'utf8');
      versionTag = V3_TAG;
    }

    // Is it a string (the format "base64", "hex", "ascii", ...) can be specifed
    else if (util.isString(data)) {
      data = new Buffer(data, 'utf8');
      versionTag = V2_TAG;
    }

    // No way, still not a buffer, forget it!
    else if (! util.isBuffer(data)) throw new Error('Invalid data for encryption');
    if (data.length < 1) throw new Error('No data available to encrypt');

    // Encrypt the data
    var initVector = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', key, initVector);
    cipher.setAAD(versionTag);
    cipher.write(data);
    cipher.end();

    var authTag = cipher.getAuthTag();
    var encryptedData = cipher.read();

    var buffer = Buffer.concat([versionTag, initVector, authTag, encryptedData]);

    // Return our encrypted data
    return { key: this.uuid, data: buffer };
  };

  /* ------------------------------------------------------------------------ *
   * Decrypt some data with this key                                          *
   * ------------------------------------------------------------------------ */
  decrypt(data) {
    var key = this[ENCRYPTION_KEY];

    // Validate what we have...
    if (! util.isBuffer(data)) throw new Error('Encrypted data must be a buffer');
    if (data.length < 30) throw new Error('No data available to decrypt');

    // Version/format
    var versionTag = null;
    var format = null;
    if (data[0] === V1_TAG[0]) {
      versionTag = V1_TAG;
      format = 'buffer';
    } else if (data[0] === V2_TAG[0]) {
      versionTag = V2_TAG;
      format = 'utf8';
    } else if (data[0] === V3_TAG[0]) {
      versionTag = V3_TAG;
      format = 'json';
    } else {
      throw new Error('Unsupported encryption version ' + data[0]);
    }


    // Extract IV, Auth Tag and real data
    var initVector    = data.slice(1, 13);
    var authTag       = data.slice(13, 29);
    var encryptedData = data.slice(29);

    // Decrypt
    var decipher = crypto.createDecipheriv('aes-256-gcm', key, initVector);
    decipher.setAAD(versionTag);
    decipher.setAuthTag(authTag);
    decipher.write(encryptedData);
    decipher.end();

    // Read out what we have
    data = decipher.read();

    // Return in whatever format we have
    if (format === 'buffer') return data;
    if (format === 'json') return JSON.parse(data.toString('utf8'));
    return data.toString(format);
  };

  /* ------------------------------------------------------------------------ *
   * Compare if this key equals another                                       *
   * ------------------------------------------------------------------------ */
  equals(object) {
    if (! object) return false;
    if (object === this) return true;

    var key = this[ENCRYPTION_KEY];
    if (object instanceof Key) return object[ENCRYPTION_KEY].equals(key);
    return false;
  };
}

/* ========================================================================== *
 * OUR KEY MANAGER CLASS                                                      *
 * ========================================================================== */

class KeyManager {

  constructor (key, client) {

    // Wrap the global encryption key
    key = new Key(UUID.NULL, key);
    const ns_key = crypto.createHmac('sha512', key[ENCRYPTION_KEY])
                         .update(new Buffer('Indexing Key', 'utf8'))
                         .digest();

    // Access to our database (RO/RW)
    if (! (client instanceof DbClient)) throw new Error('Database client not specified or invalid');

    // Our caches
    var validKeys = {};
    var deletedKeys = {};
    var cachedAt = new Date(0);

    // Generate key from database row
    function newKey(row) {
      if (! row) return null;

      var uuid          = row.uuid;
      var encryptedKey  = row.encrypted_key;
      var createdAt     = row.created_at;
      var deletedAt     = row.deleted_at;

      var k = new Key(uuid, key.decrypt(encryptedKey), createdAt, deletedAt);

      // Update our caches
      delete validKeys[uuid];
      delete deletedKeys[uuid];
      if (k.deleted_at) deletedKeys[uuid] = k;
      else validKeys[uuid] = k;

      // Return the key
      return k;
    }

    /* ---------------------------------------------------------------------- *
     * Generate a new Key and store it in in the DB                           *
     * ---------------------------------------------------------------------- */

    this.generate = function generate() {
      return new Promise(function(resolve) {

        // New encryption key from random values
        var encryptionKey = crypto.randomBytes(32);
        var encryptedKey = '\\x' + key.encrypt(encryptionKey).data.toString('hex');

        // Store in the database
        resolve(client.write(INSERT_SQL, encryptedKey)
          .then(function(result) {
            if ((! result) || (! result.rows) || (! result.rows[0])) throw new Error('No results');
            return newKey(result.rows[0]);
          }));
      });
    };

    /* ---------------------------------------------------------------------- *
     * Load an existing Key from the DB, ignoring caches but updating them    *
     * ---------------------------------------------------------------------- */

    this.load = function load(uuid) {
      return client.read(SELECT_SQL, uuid)
        .then(function(result) {
          if ((! result) || (! result.rows) || (! result.rows[0])) return null;
          return newKey(result.rows[0]);
        });
    };

    /* ---------------------------------------------------------------------- *
     * Forcedly delete a key, and wipe it from caches                         *
     * ---------------------------------------------------------------------- */

    this.delete = function delkey(uuid) {
      return client.write(DELETE_SQL, uuid)
        .then(function(result) {
          if ((! result) || (! result.rows) || (! result.rows[0])) return null;
          return newKey(result.rows[0]);
        });
    };

    /* ---------------------------------------------------------------------- *
     * Load all keys from the DB, caching them all                            *
     * ---------------------------------------------------------------------- */

    this.loadAll = function loadAll() {
      return client.read(SELECT_ALL_SQL)
        .then(function(result) {
          if ((! result) || (! result.rows) || (! result.rows[0])) return {};

          var keys = {};
          for (var i = 0; i < result.rows.length; i ++) {
            var constructed = newKey(result.rows[i]);
            keys[constructed.uuid] = constructed;
          }

          cachedAt = new Date();
          return keys;
        });
    };

    /* ---------------------------------------------------------------------- *
     * Get a valid (random, or specific) Key using caches.                    *
     * ---------------------------------------------------------------------- */

    var caching = Promise.resolve();
    this.get = function(uuid) {
      var self = this;

      // Avoid thundering horde!
      caching = caching.then(function() {
        if ((new Date().getTime() - cachedAt.getTime()) > 30000) {
          // Block on "loadAll" (which will update "cachedAt");
          return self.loadAll();
        } // Ingore errors from "loadAll"
      }).then(function() {}, function() {});

      // Do we have a UUID to a specifc key?
      if (uuid) {
        return caching.then(function() {
          //console.log('WE HAVE UUID');
          if (validKeys[uuid]) return validKeys[uuid];
          if (deletedKeys[uuid]) return deletedKeys[uuid];
          return self.load(uuid);
        });
      }

      // We don't have a specific UUID
      return caching.then(function() {
        //console.log('WE HAVE NO UUID');
        var uuids = Object.keys(validKeys);
        // No valid keys, generate and return one
        if (uuids.length === 0) return self.generate();
        // Return a random key (should use a better random)
        return validKeys[uuids[Math.floor(Math.random() * uuids.length)]];
      });
    };

    /* ---------------------------------------------------------------------- *
     * Encrypt some data using a random Key.                                  *
     * ---------------------------------------------------------------------- */

    this.encrypt = function encrypt(data) {
      return this.get().then(function(encryptionKey) {
        if (encryptionKey == null) throw new Error('Encryption key not available');
        return encryptionKey.encrypt(data);
      });
    };

    /* ---------------------------------------------------------------------- *
     * Decrypt some data using the specified Key.                             *
     * ---------------------------------------------------------------------- */

    this.decrypt = function decrypt(uuid, data) {
      return this.get(uuid).then(function(encryptionKey) {
        if (encryptionKey == null) throw new Error('Encryption key "' + uuid + '"not available');
        return encryptionKey.decrypt(data);
      });
    };

    /* ---------------------------------------------------------------------- *
     * Prepare a V5 namespace UUID from the specified scope.                  *
     * ---------------------------------------------------------------------- */

    this.namespace = function namespace(scope) {
      var uuid = scope ? new UUID(scope) : UUID.NULL;
      return UUID.v5(uuid, ns_key);
    };

    // Freeze ourselves
    Object.freeze(this);
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

KeyManager.Key = Key;
exports = module.exports = KeyManager;
