'use strict';

const DbStore = require('./db-store');
const Validator = require('./validator');

const nil = require('./uuid').NULL.toString();

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

const STORE = Symbol('store');

class Domains {
  constructor(keyManager, client) {
    this[STORE] = new DbStore("domains", keyManager, client, validator);
  }

  get(uuid, include_deleted, query) {
    return this[STORE].select(uuid, include_deleted, query);
  }

  create(attributes, query) {
    return this[STORE].insert(nil, attributes, query);
  }

  modify(uuid, attributes, query) {
    return this[STORE].update(uuid, attributes, query);
  }

  delete(uuid, query) {
    return this[STORE].delete(uuid, query);
  }
}

exports = module.exports = Domains;
