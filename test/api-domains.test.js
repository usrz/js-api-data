'use strict';

const bodyParser = require('body-parser');
const express = require('express');
const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const Api = require('../src/api');
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
    app = new Api(keyManager, testdb.client).build();

    //app = Api().use('/domains', new DomainsApi(keyManager, testdb.client)).done();
  });
  after(testdb.after);

  it('should not list all domains', function(done) {
    request(app)
      .get('/')
      .expect(404)
      .end(done);
  });

  it('should not find a random domain', function(done) {
    request(app)
      .get('/' + UUID.v4())
      .expect(404)
      .end(done);
  });

});
