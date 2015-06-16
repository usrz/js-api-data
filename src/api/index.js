'use strict';

const bodyParser = require('body-parser');
const statuses = require('express-statuses');
const express = require('express');

const log = require('errorlog')();

const domains = require('./domains');
const UUID = require('../uuid');


/* Our error handler */
function errorHandler(err, req, res, next) {

  // Response status (default 500) and error
  let status = statuses.INTERNAL_SERVER_ERROR;
  let error = null;
  if (typeof err.status === 'number') {
    res.status(err.status);
    status = statuses(err.status);
    error = err.error;
  } else {
    res.status(500);
    error = err;
  }

  // Get a body for the error
  var body = JSON.parse(JSON.stringify(err));
  if (! body.status) body.status = status.status;
  if (! body.message) body.message = status.message;
  if (! body.id) body.id = req.id || UUID.v4();

  // Log our error
  log.error('Error in "%s"', req.originalUrl, body, error);

  // Send the body back
  res.json(body).end();
}

exports = module.exports = function api(keyManager, client) {
  const app = express();

  // Basic settings
  app.set('etag', false);
  app.set('x-powered-by', false);

  // Our request UUID
  app.use(function(req, res, next) {
    req.id = req.id || UUID.v4();
    next();
  });

  // Parse JSON bodies
  app.use(bodyParser.json());

  // Our known handlers
  app.use('/domains', domains(keyManager, client));

  // Error handler
  app.use(errorHandler);

  // Return our app
  return app;
};
