'use strict';

const bodyParser = require('body-parser');
const express = require('express');
const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const api = require('../src/api');
//const DomainsApi = require('../src/api-domains');
const request = require('supertest');
const UUID = require('../src/uuid');

describe.only('Domains API', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var app;


  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    app = api(keyManager, testdb.client);
  });
  after(testdb.after);

  it('should not list all domains', function(done) {
    request(app)
      .get('/domains')
      .expect(405)
      .expect(function(res) {
        expect(UUID.validate(res.body.id)).to.exist;
        expect(res.body).to.include({
          status: 405,
          message: 'Method Not Allowed'
        });
      })
      .end(done);
  });

  it('should not find a random domain', function(done) {
    request(app)
      .get('/domains/' + UUID.v4())
      .expect(404)
      .expect(function(res) {
        expect(UUID.validate(res.body.id)).to.exist;
        expect(res.body).to.include({
          status: 404,
          message: 'Not Found'
        });
      })
      .end(done);
  });

  it('should not create an invalid domain', function(done) {
    request(app)
      .post('/domains')
      .send({name: "foo", domain_name: "foo.com"})
      .expect(404)
      .expect(function(res) {
        expect(UUID.validate(res.body.id)).to.exist;
        expect(res.body).to.include({
          status: 404,
          message: 'Not Found'
        });
      })
      .end(done);
  });

});
