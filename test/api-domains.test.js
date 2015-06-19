'use strict';

const errorlog = require('errorlog');
const bodyParser = require('body-parser');
const express = require('express');
const expect = require('chai').expect;
const KeyManager = require('../src/db').KeyManager;
const api = require('../src/api');
//const DomainsApi = require('../src/api-domains');
const supertest = require('supertest');
const UUID = require('../src/uuid');

describe('Domains API', function() {

  errorlog.defaultLevel = errorlog.ERROR;

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var http;

  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    var app = api(keyManager, testdb.client);
    http = supertest(app);
  });
  after(testdb.after);

  it('should not list all domains', function(done) {
    http.get('/domains')
        .expect(405)
        .expect(function(res) {
          expect(UUID.validate(res.body.id)).to.exist;
          expect(res.body.id).to.equal(res.headers['x-request-id']);
          expect(res.body).to.include({
            status: 405,
            message: 'Method Not Allowed'
          });
        })
        .end(done);
  });

  it('should not find a random domain', function(done) {
    http.get('/domains/' + UUID.v4())
        .expect(404)
        .expect(function(res) {
          expect(UUID.validate(res.body.id)).to.exist;
          expect(res.body.id).to.equal(res.headers['x-request-id']);
          expect(res.body).to.include({
            status: 404,
            message: 'Not Found'
          });
        })
        .end(done);
  });

  it('should not create an invalid domain', function(done) {
    http.post('/domains')
        .send({foo: "bar"})
        .expect(400)
        .expect(function(res) {
          expect(UUID.validate(res.body.id)).to.exist;
          expect(res.body.id).to.equal(res.headers['x-request-id']);
          expect(res.body).to.include({
            status: 400,
            message: 'Bad Request'
          });
          expect(res.body.details).to.eql({
            name:        [ '"name" is required' ],
            domain_name: [ '"domain_name" is required' ],
            foo:         [ '"foo" is not allowed' ]
          });
        })
        .end(done);
  });

  it('should create a valid domain', function(done) {
    http.post('/domains')
        .send({name: "name", domain_name: "example.org"})
        .expect(201)
        .expect(function(res) {
          expect(UUID.validate(res.headers['x-request-id'])).to.exist;
          expect(res.headers['location']).to.match(/^\/domains\/.*/);
          expect(UUID.validate(res.headers['location'].substr(9))).to.exist;
          expect(res.body).to.eql({name: "name", domain_name: "example.org"});
        })
        .end(done);
  });

});
