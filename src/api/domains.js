'use strict';

/// 409 -> Conflict: resource already exist!

const path = require('path');
const S = require('express-statuses');
const promising = require('../promising.js');

const DbStore = require('../db-store');
const joi = require('joi');

const validator = require('./validation')(joi.object({
    name:        joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
    domain_name: joi.string().required().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)
}));

function created(domain) {

}


exports = module.exports = function(keyManager, client) {

  let app = promising();
  let dbstore = new DbStore(keyManager, client, validator);
  let domains = new DbStore.Simple(dbstore, 'domain');

  app.get('/', function(req, res) {
    throw new S.METHOD_NOT_ALLOWED();
  });

  app.post('/', function(req, res) {
    return domains.create(null, req.body)
      .then(function(domain) {
        if (! domain) throw new S.NOT_FOUND();

        res.header('Last-Modified', domain.updated_at.toUTCString());
        res.header('Location', path.join(req.originalUrl, domain.uuid));
        res.status(S.CREATED.CODE);
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
