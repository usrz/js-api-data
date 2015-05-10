'use strict';

const DbStore = require('./db-store');
const Validator = require('./validator');

const parent = '00000000-0000-0000-0000-000000000000';
const domains = new WeakMap();

var validator = new Validator({
  name: {
    presence: true,
    type: 'string'
  },
  domain_name: {
    presence: true,
    domain: true,
    type: 'string'
  }
})

class Domains {
  constructor(keyManager, client) {
    domains.set(this, new DbStore("domains", keyManager, client, validator));
  }

  get(uuid, include_deleted) {
    return domains.get(this).select(uuid, include_deleted);
  }

  create(attributes) {
    return domains.get(this).insert(parent, attributes);
  }

  modify(uuid, attributes) {
    return domains.get(this).update(uuid, attributes);
  }

  delete(uuid) {
    return domains.get(this).delete(uuid);
  }
}

exports = module.exports = Domains;
