'use strict';

const DbStore = require('./db-store');
const Validator = require('./validator');

const nil = require('./uuid').NULL.toString();
const domains = new WeakMap();

var validator = new Validator({
  name: {
    presence: true,
    normalize: true,
    type: 'string'
  },
  domain_name: {
    presence: true,
    domain: true
  }
})

class Domains {
  constructor(keyManager, client) {
    domains.set(this, new DbStore("domains", keyManager, client, validator));
  }

  get(uuid, include_deleted, query) {
    return domains.get(this).select(uuid, include_deleted, query);
  }

  create(attributes, query) {
    return domains.get(this).insert(nil, attributes, query);
  }

  modify(uuid, attributes, query) {
    return domains.get(this).update(uuid, attributes, query);
  }

  delete(uuid, query) {
    return domains.get(this).delete(uuid, query);
  }

  exists(uuid, query) {
    return domains.get(this).exists(uuid, query);
  }
}

exports = module.exports = Domains;
