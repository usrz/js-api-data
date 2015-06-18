'use strict';

console.warn(new Error('Module "db-client" is deprecated').stack);

exports = module.exports = require('./db').KeyManager;
