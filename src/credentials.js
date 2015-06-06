'use strict';

const crypto = require('crypto');
const util   = require('util');

/* ========================================================================== *
 * CREDENTIALS CLASS                                                          *
 * ========================================================================== */
class Credentials {
  constructor(password) {

    // Check the password
    if (util.isString(password)) password = new Buffer(password, 'utf8');
    if (! util.isBuffer(password)) throw new TypeError('Password must be a string or buffer');
    if (password.length < 6) throw new Error('Corwardly refusing to save short password');

    // Calculate a salt of precisely the same length as the key
    var salt = crypto.randomBytes(20); // 160 bits, as SHA-1

    // Prepare our password as a Buffer...
    var buffer = new Buffer(password, 'utf8');

    // Encrypt the key...
    var key = crypto.pbkdf2Sync(buffer, salt, 100000, 20, 'sha1');

    // Calculate our SCRAM values...
    var serverKey = crypto.createHmac('sha256', key)
                          .update(new Buffer('Server Key', 'utf8'))
                          .digest();

    var clientKey = crypto.createHmac('sha256', key)
                          .update(new Buffer('Client Key', 'utf8'))
                          .digest();

    var storedKey = crypto.createHash('sha256')
                          .update(clientKey)
                          .digest();

    // Freeze KDF spec
    this.kdf_spec = Object.freeze({
      algorithm:          'PBKDF2',
      derived_key_length: 20,
      iterations:         100000,
      hash:               'SHA-1'
    });

    // Store computed values
    this.server_key = serverKey.toString('base64');
    this.stored_key = storedKey.toString('base64');
    this.salt = salt.toString('base64');
    this.hash = 'SHA-256';

    // Freeze ourselves
    Object.freeze(this);
  }

  toString() {
    return 'Credentials[' + this.hash + ']';
  }

}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = Credentials;
