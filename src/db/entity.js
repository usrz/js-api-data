'use strict';

const KeyManager = require('./key-manager');

/* ========================================================================== *
 * DB ENTITY CLASS                                                            *
 * ========================================================================== */

const ENCRYPTION_KEY = Symbol('encryption_key');
const ENCRYPTED_DATA = Symbol('encrypted_data');
const KEY_MANAGER = Symbol('key_manager');
const ATTRIBUTES = Symbol('attributes');

class Entity {
  constructor (row, keyManager) {
    if (! row) throw new Error('No row for DB entity');
    if (! row.uuid) throw new Error('No UUID for DB entity');
    if (! row.parent) throw new Error('No parent UUID for DB entity');
    if (! (keyManager instanceof KeyManager)) throw new Error('Invalid key manager');

    this.uuid = row.uuid;
    this.kind = row.kind;
    this.parent = row.parent;
    this.created_at = row.created_at || new Date();
    this.updated_at = row.updated_at || this.created_at;
    this.deleted_at = row.deleted_at || null;

    this[ENCRYPTION_KEY] = row.encryption_key;
    this[ENCRYPTED_DATA] = row.encrypted_data;
    this[KEY_MANAGER] = keyManager;
  }

  attributes() {
    var self = this;

    return self[ATTRIBUTES] || (self[ATTRIBUTES] = self[KEY_MANAGER].get(self[ENCRYPTION_KEY])
      .then(function(decryptionKey) {
        if (decryptionKey != null) return decryptionKey.decrypt(self[ENCRYPTED_DATA]);
        throw new Error(`Key "${self[ENCRYPTION_KEY]}" unavailable for "${self.uuid}"`);
      }));
  }

  toString() {
    return 'Entity[' + this.kind + ':' + this.uuid + ']';
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = Entity;
