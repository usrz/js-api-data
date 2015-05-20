'use strict';

const DbStore = require('./db-store');
const nil = require('./uuid').NULL.toString();
const joi = require('joi');

const validator = joi.object({
    name: joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
    domain_name: joi.string().required().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)
});

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
