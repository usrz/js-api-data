'use strict';

/// 409 -> Conflict: resource already exist!

const path = require('path');
//const Domains = require('./domains.js');
const S = require('express-statuses');
const promising = require('../promising.js');

const DbStore = require('../db-store');
const joi = require('joi');

const schema = joi.object({
    name:        joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
    domain_name: joi.string().required().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)
});

function validator(attributes) {
  var result = joi.validate(attributes, schema, { abortEarly: false });
  if (result.error) {
    console.log('ERROR', result.error);
    //return Promise.reject(result.error);
    throw new S.BAD_REQUEST({error: result.error, details: result.error.details});
  }
  return result.value;
}

exports = module.exports = function(keyManager, client) {

  let app = promising();
  let dbstore = new DbStore(keyManager, client, validator);
  //, 'domain'
  let domains = new DbStore.Simple(dbstore, 'domain'); //Domains(keyManager, client);

  app.post('/', function(req, res) {
    console.log('BODY', req.originalUrl, req.body);
    return domains.create(null, req.body)
      .then(function(domain) {
        if (! domain) throw new S.NOT_FOUND();

        res.header('Last-Modified', domain.updated_at.toUTCString());
        res.header('Location', path.join(req.originalUrl, domain.uuid));
        return domain.attributes();
      });
  });

  app.get('/:uuid', function(req, res) {
    return domains.get(req.params.uuid)
      .then(function(domain) {
        if (! domain) throw new S.NOT_FOUND();
        res.header('Last-Modified', domain.updated_at.toUTCString());
        return domain.attributes();
      });
  });

  app.put('/:uuid', function(req, res) {
    return domains.modify(req.params.uuid, req.body)
      .then(function(domain) {
        if (! domain) throw new S.NOT_FOUND();
        res.header('Last-Modified', domain.updated_at.toUTCString());
        return domain.attributes();
      });
  });

  return app;
};
