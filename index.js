'use strict';

var express = require('express');
var DbClient = require('./src/db-client.js');
var KeyManager = require('./src/key-manager.js');

var client = new DbClient('postgres://127.0.0.1/usrz')
var keyManager = new KeyManager(new Buffer(32).fill(0), client);

var domains = require('./src/api-domains.js')(keyManager, client);
const bodyParser = require('body-parser');

var app = express();

// No etag, x-powered-by
app.set('etag', false);
app.set('x-powered-by', false);

// Parse JSON bodies
app.use(bodyParser.json());

// The root of all evil...
app.use('/domains', domains);

// Our error handler
app.use(function(err, req, res, next) {
  console.log("ERROR", err.stack || err);
  if (typeof err.status === 'number') {
    res.status(err.status);
  } else {
    res.status(500);
  }
  if (typeof err.toJSON === 'function') {
    res.json(err).end();
  } else {
    res.end();
  }
});

// Listen!
var listener = app.listen(8080, '127.0.0.1', function(error) {
  if (error) done(error);
  var address = listener.address();
  console.log('Running at http://' + address.address + ':' + address.port + '/');
});
