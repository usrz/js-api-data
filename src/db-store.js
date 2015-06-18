'use strict';

console.warn(new Error('Module "db-store" is deprecated').stack);

const DbStore = require('./db').Store;
DbStore.Simple = require('./db').Factory;

exports = module.exports = DbStore;
