'use strict';

console.warn(new Error('Module "db-object" is deprecated').stack);

exports = module.exports = require('./db').DbObject;
