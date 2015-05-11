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
    users.create(domain.uuid, {email: "phony", name: 123, password: "foobar"})
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
    users.create(domain.uuid, {email: "test@example.org", name: " Test\r\nUser ", password: 'password'})
      .then(function(created) {
        expect(created).to.be.not.null;
        expect(created.attributes.name).to.equal("Test User"); // normalized
        expect(created.attributes.email).to.equal("test@example.org");
        expect(created.attributes.credentials.kdf_spec).to.eql({
          algorithm: "PBKDF2",
          derived_key_length: 20,
          iterations: 100000,
          hash: "SHA-1"
        });
        expect(created.attributes.credentials.salt).to.be.a('string');
        expect(created.attributes.credentials.server_key).to.be.a('string');
        expect(created.attributes.credentials.stored_key).to.be.a('string');
        expect(created.attributes.credentials.hash).to.equal('SHA-256');
        user = created;
        done();
      })
      .catch(done);
  })

  describe('Single user', function() {
    before(function() { if (!user) this.skip() });

    it('should get the user by uuid', function(done) {
      if (! user) return this.skip();
      users.get(user.uuid)
        .then(function(gotten) {
          expect(gotten).to.eql(user);
          done();
        })
        .catch(done);
    })

    it('should get the user by email address', function(done) {
      if (! user) return this.skip();
      users.find(user.attributes.email)
        .then(function(gotten) {
          expect(gotten).to.eql(user);
          done();
        })
        .catch(done);
    })
  })

  describe('Multiple users', function() {
    before(function() { if (!user) this.skip() });

    var user2 = null;

    it('should not create another user with the same email', function(done) {
      users.create(domain.uuid, {email: "test@example.org", name: 'A Different User', password: 'password'})
        .then(function(result) {
          throw new Error('Should have not been created');
        }, function(error) {
          // Duplicated by our existing user!
          expect(error.duplicates).to.eql({ email: user.uuid });
          done();
        })
        .catch(done);
    })

    it('should create another user with a different email address', function(done) {
      users.create(domain.uuid, {email: "foobar@example.org", name: "A Different User", password: 'password'})
        .then(function(created) {
          expect(created).to.be.not.null;
          expect(created.attributes.name).to.equal("A Different User");
          expect(created.attributes.email).to.equal("foobar@example.org");
          expect(created.attributes.credentials.kdf_spec).to.eql({
            algorithm: "PBKDF2",
            derived_key_length: 20,
            iterations: 100000,
            hash: "SHA-1"
          });
          expect(created.attributes.credentials.salt).to.be.a('string');
          expect(created.attributes.credentials.server_key).to.be.a('string');
          expect(created.attributes.credentials.stored_key).to.be.a('string');
          expect(created.attributes.credentials.hash).to.equal('SHA-256');
          user2 = created;
          done();
        })
        .catch(done);
    })

    it('should not allow modifications to an existing email address', function(done) {
    });

  })
});
