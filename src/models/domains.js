var EventEmitter = require('events').EventEmitter;
var util = require('util');

var query = require('../utils/query');

function Domains(uri) {
  var emitter = this;

  this.get = function get(uuid) {
    return query(uri, {
        'name': 'domains_get',
        'text': 'SELECTx * FROM "domains" WHERE "uuid" = $1 LIMIT 1',
        'values': [ uuid ]
      }, true);
  }

  this.find = function find(where, extra) {
    extra = extra || {};
    return query(uri, {
        'name': 'domains_find',
        'text': 'SELECT * FROM "domains"',
        'where': where,
        'order': extra.order,
        'offset': extra.offset,
        'limit': extra.limit
      });
  }

  this.create = function create(domain) {
    domain = domain || {};
    return query(uri, {
        'name': 'domains_create',
        'text': 'INSERT INTO "domains" ("name", "description") VALUES ($1, $2) RETURNING *',
        'values': [ domain.name, domain.description ]
      }, function(result) {
        var domain = result.rows[0];
        emitter.emit('created', domain);
        return domain;
      });
  }
}
util.inherits(Domains, EventEmitter);

module.exports = function domains(uri) {
  return new Domains(uri);
};
