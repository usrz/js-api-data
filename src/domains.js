'use strict';

const db = require('./db');
const joi = require('joi');

const schema = joi.object({
    name:        joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
    domain_name: joi.string().required().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)
});

class Domains extends db.Factory {
  constructor(keyManager, client) {
    super(new db.Store(keyManager, client, validator), 'domain');

    function validator(attributes) {
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
