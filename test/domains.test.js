'use strict';

const expect = require('chai').expect;
const Domains = require('../src/domains');
const uuid = require('../src/uuid');
const pg = require('pg');

describe.skip('Domains', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var domains = null;

  before(testdb.before);
  before(function() {
    domains = new Domains(testdb.ro_uri, testdb.rw_uri);
  })
  after(testdb.after);

  it('should return null fetching an invalid uuid', function(done) {
    domains.select("mario")
      .then(function(domain) {
        console.log('domain', domain);
        done();
      })
      .catch(done);
  })

  xit('should return null fetching an unknown domain', function(done) {
    domains.select(uuid.v4())
      .then(function(domain) {
        console.log('domain', domain);
        done();
      })
      .catch(done);
  })

  xit('should save a new domain', function(done) {
    domains.insert({hello: "world"})
      .then(function(domain) {
        console.log('domain', domain);
        done();
      })
      .catch(done);
  })

});
