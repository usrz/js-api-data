'use strict';

const DbClient = require('./db-client');
const UUID = require('./uuid');
const util = require('util');

function Domains(roUri, rwUri) {
  if (! roUri) throw new Error('At least one URI must be specified');
  if (! rwUri) rwUri = roUri;

  var roClient = new DbClient(roUri);
  var rwClient = new DbClient(rwUri);

  this.select = function select(uuid) {
    return new Promise(function(resolve, reject) {
      try {
        uuid = UUID(uuid).toString();
      } catch (error) {
        return resolve(null);
      }

      resolve(roClient.query('SELECT * FROM "domains" WHERE "uuid" = $1', uuid)
        .then(function(result) {
          if (!result) throw new Error('No result from database');
          if (result.rowCount == 0) return null;
          if (result.rowCount == 1) return result.rows[0];
          throw new Error('Unexpected ' + result.rowCount + ' rows from database');
        }));
    });
  }

  this.insert = function insert(attributes) {
    return new Promise(function(resolve, reject) {
      if (!util.isObject(attributes)) throw new Error('Attributes must be an object');
      var buffer = new Buffer(JSON.stringify(attributes), 'utf8');

      resolve(rwClient.query('INSERT INTO "domains" (attributes) VALUES ($1) RETURNING *', buffer)
        .then(function(result) {
          if (!result) throw new Error('No result from database');
          if (result.rowCount == 0) return null;
          if (result.rowCount == 1) {
            result.rows[0].attributes = JSON.parse(result.rows[0].attributes.toString('utf8'));
            return result.rows[0];
          }
          throw new Error('Unexpected ' + result.rowCount + ' rows from database');
        }));
    });
  }
}

exports = module.exports = Domains;
