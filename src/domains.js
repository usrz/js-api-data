'use strict';

const DbStore = require('./db-store');
const UUID = require('./uuid');
const util = require('util');

const domain_placeholder = UUID.NULL.toString();
const domains = new WeakMap();

class Domains {
  constructor(keyManager, roClient, rwClient) {
    domains.set(this, new DbStore("domains", keyManager, roClient, rwClient));
  }

  find(uuid, include_deleted) {
    return domains.get(this).select(uuid, include_deleted);
  }

  create(attributes) {
    return domains.get(this).insert(domain_placeholder, attributes);
  }

  modify(uuid, attributes) {
    return domains.get(this).update(uuid, attributes);
  }

  delete(uuid) {
    return domains.get(this).delete(uuid);
  }
}

exports = module.exports = Domains;
