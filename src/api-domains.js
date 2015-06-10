'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const Domains = require('./domains.js');

function wrap(fn) {
  return function(req, res, next) {
    var p = fn(req, res, next);
    if (! p) return;

    if (typeof p.then === 'function') {
      p.then(function(result) {
        if (res._header) return;
        if (result === null) return res.status(404).end();
        if (result) return res.status(200).send(result).end();
        res.status(500).send('Unterminated response');
      }, function(error) {
        next(error);
      });
    }
  }
}

exports = module.exports = function(keyManager, client) {

  let app = express();
  let domains = new Domains(keyManager, client);

  app.use(bodyParser.json());

  app.post('/', wrap(function(req, res, next) {
    console.log('BODY', req.body);
    return domains.create(req.body)
      .then(function(domain) {
        if (! domain) return null;
        res.header('Last-Modified', domain.updated_at);
        res.header('Location', req.originalUrl + domain.uuid);
        return domain.attributes();
      });
  }));

  app.get('/:uuid', wrap(function(req, res, next) {
    console.log("GETTING DOMAIN", req.params.uuid);
    return domains.get(req.params.uuid)
      .then(function(domain) {
        if (! domain) return null;

        res.header('Last-Modified', domain.updated_at);
        return domain.attributes();
      })
  }));

  return app;
}
