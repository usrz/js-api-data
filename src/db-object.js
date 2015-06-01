'use strict';

const KeyManager = require('./key-manager');

/* ========================================================================== *
 * DB OBJECT CLASS                                                            *
 * ========================================================================== */

const ENCRYPTION_KEY = Symbol('encryption_key');
const ENCRYPTED_DATA = Symbol('encrypted_data');
const KEY_MANAGER    = Symbol('key_manager');
const ATTRIBUTES     = Symbol('attributes');

class DbObject {
  constructor (row, keyManager) {
    if (! row) throw new Error('No row for DB object');
    if (! row.uuid) throw new Error('No UUID for DB object');
    if (! row.parent) throw new Error('No parent UUID for DB object');
    if (!(keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    this.uuid = row.uuid;
    this.kind = row.kind;
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

    if (self[ATTRIBUTES] != null) return Promise.resolve(self[ATTRIBUTES]);

    return self[KEY_MANAGER].get(self[ENCRYPTION_KEY])
      .then(function(decryption_key) {
        if (decryption_key != null) return decryption_key.decrypt(self[ENCRYPTED_DATA]);
        throw new Error(`Key "${self[ENCRYPTION_KEY]}" unavailable for "${self.uuid}"`);
      })
      .then(function(attributes) {
        self[ATTRIBUTES] = attributes;
        return attributes;
      })
  }

  toString() {
    return 'DbObject[' + this.kind + ':' + this.uuid + ']';
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = DbObject;
