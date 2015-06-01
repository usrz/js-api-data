 'use strict';

const UUID = require('UUID');
const joi = require('joi');

const validator = joi.object({
  name: joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
  members: joi.array().required().items(joi.string().regex(UUID.EXPR)),
  posix_name: joi.string().regex(/^[a-z_][a-z0-9\._-]*\$?$/).trim().lowercase().min(1).max(32),
  posix_gid: joi.number().integer().min(1).max(0x7FFFFFFF),
}).and('posix_uid', 'posix_gid', 'posix_name');


class Groups {
  constructor(keyManager, client) {
    this[CLIENT] = client;
    this[STORE] = new DbStore(keyManager, client, validator);
    this[INDEX] = new DbIndex(keyManager, client);
    this[DOMAINS] = new Domains(keyManager, client);
  }

  get(uuid, include_deleted, query) {
    var self = this;

    // Optional parameter
    if (util.isFunction(include_deleted)) {
      query = include_deleted;
      include_deleted = false;
    }

    // Potentially, this might be called from a transaction
    if (! query) return self[CLIENT].read(function(query) {
      return self.get(uuid, include_deleted, query);
    });

    return this[STORE].select(uuid, 'group', include_deleted, query);
  }
