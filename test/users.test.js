'use strict'

const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const Domains = require('../src/domains');
const Users = require('../src/users');

describe.only('Users', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var domains = null;
  var domain = null;
  var users = null;
  var user = null;

  before(testdb.before);
  before(function(done) {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    domains = new Domains(keyManager, testdb.client);
    users = new Users(keyManager, testdb.client);

    domains.create({ name: "Test Domain", domain_name: "example.com" })
      .then(function(created) {
        domain = created;
        done();
      }, done);
  })
  after(testdb.after);

  it('should not create with an invalid domain', function(done) {
    users.create('4b46e47d-e3ca-4ed5-a9ba-952359f4374d', {email: "test@example.org"})
      .then(function(created) {
        expect(created).to.be.null;
        done();
      })
      .catch(done);
  });

  it('should not create with invalid attributes', function(done) {
    users.create(domain.uuid, {email: "phony", name: 123})
      .then(function(created) {
        throw new Error('Nothing should have been created');
      }, function(error) {
        expect(error.validation).to.eql({
          email: [ "Email is not a valid email" ],
          name: [ "Name must be a string" ]
        });
        done();
      })
      .catch(done);
  });

  it('should create a valid user', function(done) {
    users.create(domain.uuid, {email: "test@example.org", name: " Test\r\nUser "})
      .then(function(created) {
        expect(created).to.be.not.null;
        expect(created.attributes).to.eql({
          email: "test@example.org",
          name: "Test User"
        });
        done();
      })
      .catch(done);
  })
});
