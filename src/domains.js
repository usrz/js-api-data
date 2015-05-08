'use strict';

const DbStore = require('./db-store');

const domains = new WeakMap();

class Domains {
  constructor(keyManager, client) {
    domains.set(this, new DbStore("domains", keyManager, client));
  }

  find(uuid, include_deleted) {
    return domains.get(this).select(uuid, include_deleted);
  }

  create(attributes) {
    return domains.get(this).insert(attributes);
  }

  modify(uuid, attributes) {
    return domains.get(this).update(uuid, attributes);
  }

  delete(uuid) {
    return domains.get(this).delete(uuid);
  }
}

exports = module.exports = Domains;
