'use strict';

console.warn(new Error('Module "db-index" is deprecated').stack);

exports = module.exports = require('./db').Index;
