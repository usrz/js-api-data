'use strict';

console.warn(new Error('Module "db-client" is deprecated').stack);

const DbClient = require('./db').Client;
DbClient.DbError = require('./db').ClientError;

exports = module.exports = DbClient;
