'use strict';

/// 409 -> Conflict: resource already exist!

const express = require('express');
const bodyParser = require('body-parser');
const Domains = require('./domains.js');

exports = module.exports = function(keyManager, client) {

  let app = express();
  let domains = new Domains(keyManager, client);

  app.use(bodyParser.json());

  app.post('/', function(req, res, next) {
    console.log('BODY', req.body);
    return domains.create(req.body)
      .then(function(domain) {
        if (! domain) return null;
        res.header('Last-Modified', domain.updated_at);
        res.header('Location', req.originalUrl + domain.uuid);
        return domain.attributes();
      });
  });

  app.get('/:uuid', function(req, res, next) {
    domains.get(req.params.uuid)
      .then(function(domain) {
        if (! domain) return null;

        res.header('Last-Modified', domain.updated_at);
        return domain.attributes();
      })
      .catch(next);
  });

  return app;
}
