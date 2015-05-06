'use strict';

const crypto = require('crypto');
const util = require('util');

const DbClient = require('./db-client');
const UUID = require('./uuid');

const INSERT_SQL = 'INSERT INTO "encryption_keys" '
                 + '("init_vector", "encrypted_key", "auth_tag") '
                 + 'VALUES ($1::BYTEA, $2::BYTEA, $3::BYTEA) '
                 + 'RETURNING *';
const SELECT_ALL_SQL = 'SELECT * FROM "encryption_keys"';
const SELECT_SQL = SELECT_ALL_SQL + ' WHERE uuid=$1';
const DELETE_SQL = 'DELETE FROM "encryption_keys" WHERE uuid=$1';

/* ========================================================================== *
 * OUR KEY CLASS (encrypts, decripts, hides key buffer)                       *
 * ========================================================================== */

function Key(uuid, key, created_at, deleted_at) {
  // Validate/normalize UUID
  this.uuid = uuid = UUID(uuid).toString();

  // Validate encryption key
  if (!util.isBuffer(key)) throw new Error('Encryption key is not a buffer');
  if (key.length != 32) throw new Error('Encryption key must be 256 bits long');

  // Remember our created/deleted dates (if any)
  this.created_at = created_at ? created_at : new Date();
  this.deleted_at = deleted_at || null;

  // Data encryption
  this.encrypt = function encrypt(data, format) {
    if ((! util.isBuffer(data)) && util.isObject(data)) data = new Buffer(JSON.stringify(data), 'utf8');
    if (util.isString(data)) data = new Buffer(data, format || 'utf8');
    if (! util.isBuffer(data)) throw new Error('Invalid data for encryption');
    if (data.length < 1) throw new Error('No data available to encrypt');

    // Encrypt the data
    var init_vector = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv('aes-256-gcm', key, init_vector);
    cipher.write(data);
    cipher.end();

    var auth_tag = cipher.getAuthTag();
    var encrypted_data = cipher.read();

    // Return our encrypted data
    return Object.freeze({
      encryption_key: uuid,
      init_vector: init_vector,
      encrypted_data: encrypted_data,
      auth_tag: auth_tag
    });
  }

  // Data decryption
  this.decrypt = function decrypt(init_vector, encrypted_data, auth_tag, format) {

    // If we were called with ({...}, "format")
    if ((! util.isBuffer(init_vector)) && util.isObject(init_vector)) {
      format = encrypted_data; // format is the second argument
      auth_tag = init_vector.auth_tag;
      encrypted_data = init_vector.encrypted_data;
      init_vector = init_vector.init_vector;
    }

    // Validate what we have...
    if (! util.isBuffer(init_vector)) throw new Error('Initialization vector must be a buffer');
    if (! util.isBuffer(encrypted_data)) throw new Error('Encrypted data must be a buffer');
    if (! util.isBuffer(auth_tag)) throw new Error('Authentication tag must be a buffer');
    if (init_vector.length != 12) throw new Error('Initialization vector must be exactly 96 bits');
    if (auth_tag.length != 16) throw new Error('Authentication tag must be exactly 128 bits');
    if (encrypted_data.length < 1) throw new Error('No data available to decrypt');

    // Decrypt the data
    var decipher = crypto.createDecipheriv('aes-256-gcm', key, init_vector);
    decipher.setAuthTag(auth_tag);
    decipher.write(encrypted_data);
    decipher.end();

    // Read out what we have
    var data = decipher.read();

    // Return in whatever format we have
    if ((! format) || (format === 'buffer')) return data;
    if (format === 'json') return JSON.parse(data.toString('utf8'));
    return buffer.toString(format);
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

function EncryptionKeys(key, roUri, rwUri) {
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

    var uuid          = row.uuid;
    var init_vector   = row.init_vector;
    var encrypted_key = row.encrypted_key;
    var auth_tag      = row.auth_tag;
    var created_at    = row.created_at;
    var deleted_at    = row.deleted_at;
    var decrypted_key = key.decrypt(init_vector, encrypted_key, auth_tag);

    var k = new Key(uuid, decrypted_key, created_at, deleted_at);

    // Update our caches
    delete valid_keys[uuid];
    delete deleted_keys[uuid];
    if (k.deleted_at) deleted_keys[uuid] = k;
    else valid_keys[uuid] = k;

    // Return the key
    return k;
  }

  // Generate and save a new encryption key
  this.generate = function generate() {
    return new Promise(function(resolve, reject) {

      // New encryption key from random values
      var encryption_key = crypto.randomBytes(32);
      var encrypted_key = key.encrypt(encryption_key);

      // var init_vector = encrypted_key.init_vector;
      var init_vector = "\\x" + encrypted_key.init_vector.toString('hex');
      var encrypted_data = "\\x" + encrypted_key.encrypted_data.toString('hex');
      var auth_tag = "\\x" + encrypted_key.auth_tag.toString('hex');

      // Store in the database
      resolve(rwClient.query(INSERT_SQL, init_vector, encrypted_data, auth_tag)
        .then(function(result) {
          return newKey(result.rows[0]);
        }));
    })
  }

  // Load a single key
  this.load = function load(uuid) {
    return roClient.query(SELECT_SQL, uuid)
      .then(function(result) {
        if ((! result) || (! result.rows[0])) return null;
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
          if ((! result) || (! result.rows[0])) return null;

          // Actually delete the result
          return query(DELETE_SQL, uuid)
            .then(function(result) {
              return query(SELECT_SQL, uuid);
            })

            .then(function(result) {
              // Return the old key, but with "deleted_at" set
              if ((! result) || (! result.rows[0])) return null;
              return newKey(result.rows[0]);
            })
        })
    });
  }

  // Load all keys
  this.loadAll = function loadAll() {
    return roClient.query(SELECT_ALL_SQL)
      .then(function(result) {
        if ((! result) || (! result.rows)) return {};

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

  // Freeze ourselves
  Object.freeze(this);
}

exports = module.exports = EncryptionKeys;

