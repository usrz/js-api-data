'use strict';

const crypto = require('crypto');
const util = require('util');

const DbClient = require('./db-client');
const UUID = require('./uuid');

const INSERT_SQL = 'INSERT INTO "encryption_keys" ("encrypted_key") VALUES ($1::BYTEA) RETURNING *';
const SELECT_ALL_SQL = 'SELECT * FROM "encryption_keys"';
const SELECT_SQL = SELECT_ALL_SQL + ' WHERE uuid=$1';
const DELETE_SQL = 'DELETE FROM "encryption_keys" WHERE uuid=$1';

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

function Key(uuid, key, created_at, deleted_at) {
  if (!(this instanceof Key)) return new Key(uuid, key, created_at, deleted_at);

  // Validate/normalize UUID
  this.uuid = uuid = UUID(uuid).toString();

  // Validate encryption key
  if (!util.isBuffer(key)) throw new Error('Encryption key is not a buffer');
  if (key.length != 32) throw new Error('Encryption key must be 256 bits long');

  // Remember our created/deleted dates (if any)
  this.created_at = created_at ? created_at : new Date();
  this.deleted_at = deleted_at || null;

  // Data encryption
  this.encrypt = function encrypt(data) {

    // Default, buffers
    var vx_tag = V1_TAG;

    // Determine whatever we are given, is it a (non-buffer) Object?
    if ((! util.isBuffer(data)) && util.isObject(data)) {
      data = new Buffer(JSON.stringify(data), 'utf8');
      vx_tag = V3_TAG;
    }

    // Is it a string (the format "base64", "hex", "ascii", ...) can be specifed
    else if (util.isString(data)) {
      data = new Buffer(data, 'utf8');
      vx_tag = V2_TAG;
    }

    // No way, still not a buffer, forget it!
    else if (! util.isBuffer(data)) throw new Error('Invalid data for encryption');
    if (data.length < 1) throw new Error('No data available to encrypt');

    // Encrypt the data
    var init_vector = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', key, init_vector);
    cipher.setAAD(vx_tag);
    cipher.write(data);
    cipher.end();

    var auth_tag = cipher.getAuthTag();
    var encrypted_data = cipher.read();

    var buffer = new Buffer.concat([vx_tag, init_vector, auth_tag, encrypted_data]);

    // Return our encrypted data
    return { key: uuid, data: buffer }
  }

  // Data decryption
  this.decrypt = function decrypt(data) {

    // Validate what we have...
    if (! util.isBuffer(data)) throw new Error('Encrypted data must be a buffer');
    if (data.length < 30) throw new Error('No data available to decrypt');

    // Version/format
    var vx_tag = null;
    var format = null;
    if (data[0] == V1_TAG[0]) {
      vx_tag = V1_TAG;
      format = 'buffer';
    } else if (data[0] == V2_TAG[0]) {
      vx_tag = V2_TAG;
      format = 'utf8';
    } else if (data[0] == V3_TAG[0]) {
      vx_tag = V3_TAG;
      format = 'json';
    } else {
      throw new Error('Unsupported encryption version ' + data[0]);
    }


    // Extract IV, Auth Tag and real data
    var init_vector    = data.slice(1, 13);
    var auth_tag       = data.slice(13, 29);
    var encrypted_data = data.slice(29);

    // Decrypt
    var decipher = crypto.createDecipheriv('aes-256-gcm', key, init_vector);
    decipher.setAAD(vx_tag);
    decipher.setAuthTag(auth_tag);
    decipher.write(encrypted_data);
    decipher.end();

    // Read out what we have
    var data = decipher.read();

    // Return in whatever format we have
    if (format === 'buffer') return data;
    if (format === 'json') return JSON.parse(data.toString('utf8'));
    return data.toString(format);
  }

  this.equals = function equals(object) {
    if (object === this) return true;
    if (object instanceof Key) return object.equals(key);
    if (util.isBuffer(object)) return Buffer.compare(key, object) == 0;
    return false;
  }

  // Freeze ourselves
  Object.freeze(this);
}

/* ========================================================================== *
 * OUR KEY MANAGER CLASS                                                      *
 * ========================================================================== */

function KeyManager(key, roUri, rwUri) {
  if (!(this instanceof KeyManager)) return new KeyManager(key, roUri, rwUri);

  // Wrap the global encryption key
  key = new Key(UUID.NULL, key);

  // Access to our database (RO/RW)
  if (! roUri) throw new Error('At least one URI must be specified');
  if (! rwUri) rwUri = roUri;
  var roClient = new DbClient(roUri);
  var rwClient = new DbClient(rwUri);

  // Our caches
  var valid_keys = {};
  var deleted_keys = {};
  var cached_at = new Date(0);

  // Generate key from database row
  function newKey(row) {
    if (! row) return null;

    var uuid           = row.uuid;
    var encrypted_key  = row.encrypted_key;
    var created_at     = row.created_at;
    var deleted_at     = row.deleted_at;

    var k = new Key(uuid, key.decrypt(encrypted_key), created_at, deleted_at);

    // Update our caches
    delete valid_keys[uuid];
    delete deleted_keys[uuid];
    if (k.deleted_at) deleted_keys[uuid] = k;
    else valid_keys[uuid] = k;

    // Return the key
    return k;
  }

  /* ------------------------------------------------------------------------ *
   * Exported methods                                                         *
   * ------------------------------------------------------------------------ */

  // Generate and save a new encryption key
  this.generate = function generate() {
    return new Promise(function(resolve, reject) {

      // New encryption key from random values
      var encryption_key = crypto.randomBytes(32);
      var encrypted_key = '\\x' + key.encrypt(encryption_key).data.toString('hex');

      // Store in the database
      resolve(rwClient.query(INSERT_SQL, encrypted_key)
        .then(function(result) {
          if ((! result) || (! result.rows) || (! result.rows[0])) throw new Error('No results');
          return newKey(result.rows[0]);
        }));
    })
  }

  // Load a single key
  this.load = function load(uuid) {
    return roClient.query(SELECT_SQL, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return null;
        return newKey(result.rows[0]);
      });
  }

  // Delete a single key
  this.delete = function delkey(uuid) {
    // This runs in a transaction
    return rwClient.transaction(function(query) {
      // Check if we haven't deleted before
      return query(SELECT_SQL + ' AND deleted_at IS NULL', uuid)
        .then(function(result) {
          // No valid result? Skip the rests
          if ((! result) || (! result.rows) || (! result.rows[0])) return null;

          // Actually delete the result
          return query(DELETE_SQL, uuid)
            .then(function(result) {
              return query(SELECT_SQL, uuid);
            })

            .then(function(result) {
              // Return the old key, but with "deleted_at" set
              if ((! result) || (! result.rows) || (! result.rows[0])) return null;
              return newKey(result.rows[0]);
            })
        })
    });
  }

  // Load all keys
  this.loadAll = function loadAll() {
    return roClient.query(SELECT_ALL_SQL)
      .then(function(result) {
        if ((! result) || (! result.rows) || (! result.rows[0])) return {};

        var keys = {};
        for (var i = 0; i < result.rows.length; i ++) {
          var key = newKey(result.rows[i]);
          keys[key.uuid] = key;
        }

        cached_at = new Date();
        return keys;
      });
  }

  // Get a key, either cached or loaded
  var caching = Promise.resolve();
  this.get = function(uuid) {
    var self = this;

    // Avoid thundering horde!
    caching = caching.then(function() {
      if ((new Date().getTime() - cached_at.getTime()) > 30000) {
        // Block on "loadAll" (which will update "cached_at");
        return self.loadAll();
      } // Ingore errors from "loadAll"
    }).then(function() {}, function() {})

    // Do we have a UUID to a specifc key?
    if (uuid) return caching.then(function() {
      //console.log('WE HAVE UUID');
      if (valid_keys[uuid]) return valid_keys[uuid];
      if (deleted_keys[uuid]) return deleted_keys[uuid];
      return self.load(uuid);
    })

    // We don't have a specific UUID
    return caching.then(function() {
      //console.log('WE HAVE NO UUID');
      var uuids = Object.keys(valid_keys);
      // No valid keys, generate and return one
      if (uuids.length == 0) return self.generate();
      // Return a random key (should use a better random)
      return valid_keys[uuids[Math.floor(Math.random() * uuids.length)]];
    })
  };

  // Encrypt some data (convenience method)
  this.encrypt = function encrypt(data) {
    return this.get().then(function(encryption_key) {
      if (encryption_key == null) throw new Error('Encryption key not available');
      return encryption_key.encrypt(data);
    });
  }

  // Decrypt some data (convenience method)
  this.decrypt = function decrypt(uuid, data) {
    return this.get(uuid).then(function(encryption_key) {
      if (encryption_key == null) throw new Error('Encryption key "' + uuid + '"not available');
      return encryption_key.decrypt(data);
    });
  }

  // Freeze ourselves
  Object.freeze(this);
}

exports = module.exports = KeyManager;

