'use strict';

const express = require('express');
const bodyParser = require('body-parser');

const APP = Symbol('app');

/* Our error handler function */
var errorHandler = function(err, req, res, next) {
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
}

class Api {
  constructor(keyManager, client) {
    // Wrap our app...
    const app = this[APP] = express();

    // Basic settings
    app.set('etag', false);
    app.set('x-powered-by', false);

    // Parse JSON bodies
    app.use(bodyParser.json());

    // Our known handlers
    app.use('/domains', require('./domains')(keyManager, client));
  }

  use() {
    this[APP].use.apply(this[APP], arguments);
    return this;
  }

  build() {
    this[APP].use(errorHandler);
    return this[APP];
  }
}

exports = module.exports = Api;
