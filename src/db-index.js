'use strict';

console.warn(new Error('Module "db-index" is deprecated').stack);

const DbIndex = require('./db').Indexer;
DbIndex.IndexError = require('./db').IndexingError;

exports = module.exports = DbIndex;
