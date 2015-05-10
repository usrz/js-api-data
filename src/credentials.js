'use strict';

const crypto = require('crypto');
const util = require('util');

const DEFAULT_ALGORITHM = 'PBKDF2';
const DEFAULT_SCRAM_HASH = 'SHA-256';
const DEFAULT_KDF_HASH = 'SHA-1';
const DEFAULT_ITERATIONS = 100000;
const MINIMUM_ITERATIONS = 5000;

/* Hash names normalization */
const hashLength = { "SHA-1": 20, "SHA-256": 32, "SHA-384": 48, "SHA-512": 64 };
const hashNameExpr = /^sha-?(1|256|384|512)$/i;
function hashName(name) {
  var result = hashNameExpr.exec(name);
  if (! result) throw new Error(`Unknown or unsupported hash "${name}"`);
  return `SHA-${result[1]}`;
}

/* XOR two buffers */
function xor(buffer1, buffer2) {
  if (! util.isBuffer(buffer1)) throw new TypeError('Buffer 1 is not a buffer');
  if (! util.isBuffer(buffer2)) throw new TypeError('Buffer 2 is not a buffer');
  if (buffer1.length != buffer2.length) throw new Error('Buffer lengths mismatch');
  var buffer = new Buffer(buffer1.length);
  for (var i = 0; i < buffer2.length; i ++) {
    buffer[i] = buffer1[i] ^ buffer2[i];
  }
  return buffer;
}

/* Generate some credentials from a password */
function generate(password, kdf_spec, scram_hash) {

  // Check the password
  if (util.isString(password)) password = new Buffer(password, 'utf8');
  if (! util.isBuffer(password)) throw new TypeError('Password must be a string or buffer');
  if (password.length < 6) throw new TypeError('Corwardly refusing to save short password');

  // Normalize/validate scram hash parameter
  scram_hash = hashName(scram_hash || DEFAULT_SCRAM_HASH);
  var scram_hash_crypto = scram_hash.replace(/SHA-/g, 'sha');

  // Normalize/validate KDF spec
  if (! kdf_spec) kdf_spec = {};
  if (! util.isObject(kdf_spec)) throw new TypeError("KDF specification must be a object or null");

  // Triple check algorithm (just in case);
  var algorithm = String(kdf_spec.algorithm || DEFAULT_ALGORITHM).toUpperCase();
  if (algorithm != 'PBKDF2') throw new Error(`Unsupported KDF algorithm "${algorithm}"`);

  // Check KDF hash, and extract key length
  var kdf_hash = hashName(kdf_spec.hash || DEFAULT_KDF_HASH);
  var kdf_hash_crypto = kdf_hash.replace(/SHA-/g, 'sha');
  var key_length = hashLength[kdf_hash];

  // Check iterations
  var iterations = parseInt(kdf_spec.iterations) || DEFAULT_ITERATIONS;
  if (iterations < MINIMUM_ITERATIONS) throw new Error(`Invalid iterations ${iterations} (min=${MINIMUM_ITERATIONS})`);

  // Calculate a salt of precisely the same length as the key
  var salt = crypto.randomBytes(key_length);

  // Prepare our password as a Buffer
  var buffer = new Buffer(password, 'utf8');

  // Encrypt the key
  var key = crypto.pbkdf2Sync(buffer, salt, iterations, key_length, kdf_hash_crypto)

  // Our SCRAM values...
  var server_key = crypto.createHmac(scram_hash_crypto, key)
                         .update(new Buffer('Server Key', 'utf8'))
                         .digest();

  var client_key = crypto.createHmac(scram_hash_crypto, key)
                         .update(new Buffer('Client Key', 'utf8'))
                         .digest();

  var stored_key = crypto.createHash(scram_hash_crypto)
                         .update(client_key)
                         .digest();

  // Return our credentials
  return {
    kdf_spec: {
      algorithm: algorithm,
      hash: kdf_hash,
      iterations: iterations,
      derived_key_length: key_length
    },
    hash: scram_hash,
    server_key: server_key,
    stored_key: stored_key,
    salt: salt
  };
}

/* ========================================================================== *
 * CREDENTIALS CLASS                                                          *
 * ========================================================================== */
class Credentials {
  constructor(cred) {
    if (util.isString(cred)) cred = generate(cred);

    if (! util.isObject(cred)) throw new TypeError('Missing credentials definition');

    if (! util.isObject(cred.kdf_spec)) throw new TypeError('Missing or invalid kdf specification');
    var kdf_spec = Object.freeze(JSON.parse(JSON.stringify(cred.kdf_spec)));

    if (! util.isString(cred.hash)) throw new TypeError('Missing or invalid scram hash');
    var hash = cred.hash;

    var stored_key = null;
    if (util.isString(cred.stored_key)) stored_key = new Buffer(cred.stored_key, 'base64');
    else if (util.isBuffer(cred.stored_key)) stored_key = cred.stored_key;
    else if (! util.isNullOrUndefined(cred.stored_key)) throw new TypeError('Invalid stored key');

    var server_key = null;
    if (util.isString(cred.server_key)) server_key = new Buffer(cred.server_key, 'base64');
    else if (util.isBuffer(cred.server_key)) server_key = cred.server_key;
    else if (! util.isNullOrUndefined(cred.server_key)) throw new TypeError('Invalid server key');

    var salt = null;
    if (util.isString(cred.salt)) salt = new Buffer(cred.salt, 'base64');
    else if (util.isBuffer(cred.salt)) salt = cred.salt;
    else throw new TypeError('Invalid or missing salt');

    Object.defineProperties(this, {
      kdf_spec:   { enumerable: true, configurable: false, value: kdf_spec   },
      server_key: { enumerable: true, configurable: false, value: server_key },
      stored_key: { enumerable: true, configurable: false, value: stored_key },
      salt:       { enumerable: true, configurable: false, value: salt       },
      hash:       { enumerable: true, configurable: false, value: hash       }
    });
  }

  /* ---------------------------------------------------------------------- *
   * Conversion to string and JSON object                                   *
   * ---------------------------------------------------------------------- */

  toString() {
    return Credentials + '[' + this.hash + ']';
  }

  toJSON() {
    return {
      kdf_spec:   this.kdf_spec,
      server_key: this.server_key ? this.server_key.toString('base64') : null,
      stored_key: this.stored_key ? this.stored_key.toString('base64') : null,
      salt:       this.salt.toString('base64'),
      hash:       this.hash
    }
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = Credentials;
