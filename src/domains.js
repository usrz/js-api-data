'use strict';

const DbStore = require('./db-store');
const joi = require('joi');

const schema = joi.object({
    name: joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
    domain_name: joi.string().required().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)
});

class Domains extends DbStore.Simple {
  constructor(keyManager, client) {
    super(new DbStore(keyManager, client, validator), 'domain');

    function validator(attributes, query, parent) {
      var result = joi.validate(attributes, schema, { abortEarly: false });
      if (result.error) return Promise.reject(result.error);
      return result.value;
    }

  }

  create(attributes, query) {
    return super.create(null, attributes, query);
  }
}

exports = module.exports = Domains;
