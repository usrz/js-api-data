'use strict'

const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const Domains = require('../src/domains');
const Users = require('../src/users');

describe('Users', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var domains = null;
  var domain = null;
  var users = null;
  var user = null;
  var attr = null;

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
        expect(created).to.exist;
        return created.attributes()
          .then(function(attributes) {
            expect(attributes.name).to.equal("Test User"); // normalized
            expect(attributes.email).to.equal("test@example.org");
            expect(attributes.password).to.not.exist;
            expect(attributes.credentials.kdf_spec).to.eql({
              algorithm: "PBKDF2",
              derived_key_length: 20,
              iterations: 100000,
              hash: "SHA-1"
            });
            expect(attributes.credentials.salt).to.be.a('string');
            expect(attributes.credentials.server_key).to.be.a('string');
            expect(attributes.credentials.stored_key).to.be.a('string');
            expect(attributes.credentials.hash).to.equal('SHA-256');
            user = created;
            attr = attributes;
            done();
          })
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
      users.find(attr.email)
        .then(function(gotten) {
          expect(gotten).to.eql(user);
          done();
        })
        .catch(done);
    })

    it('should modify our created user', function(done) {
      if (!user) this.skip();

      users.modify(user.uuid, {email: "test1@example.org", password: 'different'})
        .then(function(modified) {
          expect(modified).to.be.not.null;
          expect(modified.created_at.getTime()).to.equal(user.created_at.getTime());
          expect(modified.updated_at.getTime()).to.not.equal(user.updated_at.getTime());

          return modified.attributes()
            .then(function(attributes) {
              expect(attributes.name).to.equal("Test User"); // normalized
              expect(attributes.email).to.equal("test1@example.org");
              expect(attributes.password).to.not.exist;
              expect(attributes.credentials.kdf_spec).to.eql({
                algorithm: "PBKDF2",
                derived_key_length: 20,
                iterations: 100000,
                hash: "SHA-1"
              });
              expect(attributes.credentials.salt).to.be.a('string');
              expect(attributes.credentials.server_key).to.be.a('string');
              expect(attributes.credentials.stored_key).to.be.a('string');
              expect(attributes.credentials.hash).to.equal('SHA-256');

              expect(attributes.credentials.salt).to.not.equal(attr.credentials.salt);
              expect(attributes.credentials.server_key).to.not.equal(attr.credentials.server_key);
              expect(attributes.credentials.stored_key).to.not.equal(attr.credentials.stored_key);

              user = modified;
              attr = attributes;
              done();
            })
        })
        .catch(done);
    })

    it('should get the user by its new email address', function(done) {
      if (! user) return this.skip();
      users.find(attr.email)
        .then(function(gotten) {
          expect(gotten).to.eql(user);
          done();
        })
        .catch(done);
    })

    it('should not get the user by its old email address', function(done) {
      if (! user) return this.skip();
      users.find('test@example.org')
        .then(function(gotten) {
          expect(gotten).to.be.null;
          done();
        })
        .catch(done);
    })
  })

  describe('Multiple users', function() {
    before(function() { if (!user) this.skip() });

    var user2 = null;
    var attr2 = null;

    it('should not create another user with the same email', function(done) {
      users.create(domain.uuid, {email: "test1@example.org", name: 'A Different User', password: 'password'})
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
      users.create(domain.uuid, {email: "test2@example.org", name: "A Different User", password: 'password'})
        .then(function(created) {
          expect(created).to.be.not.null;
          return created.attributes()
            .then(function(attributes) {
              expect(attributes.name).to.equal("A Different User");
              expect(attributes.email).to.equal("test2@example.org");
              expect(attributes.credentials.kdf_spec).to.eql({
                algorithm: "PBKDF2",
                derived_key_length: 20,
                iterations: 100000,
                hash: "SHA-1"
              });
              expect(attributes.credentials.salt).to.be.a('string');
              expect(attributes.credentials.server_key).to.be.a('string');
              expect(attributes.credentials.stored_key).to.be.a('string');
              expect(attributes.credentials.hash).to.equal('SHA-256');
              user2 = created;
              done();
            })
        })
        .catch(done);
    })

    it('should not allow modifications to an existing email address', function(done) {
      users.modify(user2.uuid, {email: "test1@example.org"})
        .then(function(modified) {
          throw new Error('Should have not been modified');
        }, function(error) {
          expect(error.owner).to.equal(user2.uuid);
          expect(error.duplicates.email).to.equal(user.uuid);
          done();
        })
        .catch(done);
    });

    it('should return all users when looking for domain users', function(done) {
      users.domain(domain.uuid)
        .then(function(list) {
          expect(list[user.uuid]).to.exist;
          expect(list[user2.uuid]).to.exist;
          done();
        })
        .catch(done);
    })

    it('should reassign the email from a deleted user', function(done) {
      users.delete(user.uuid)
        .then(function(deleted) {
          expect(deleted.uuid).to.equal(user.uuid);
          expect(deleted.deleted_at).to.be.instanceof(Date);
          return users.modify(user2.uuid, {email: "test1@example.org"})
        })
        .then(function(modified) {
          expect(modified.uuid).to.equal(user2.uuid);
          return modified.attributes()
            .then(function(attributes) {
              expect(attributes.email).to.equal('test1@example.org');
              user2 = modified;
              attr2 = attributes;

              // Now get all the users for the domain...
              return users.domain(domain.uuid)
            });
        })
        .then(function(list) {
          expect(Object.keys(list).length).to.equal(1);
          expect(list[user2.uuid]).to.eql(user2);
          // Check again, but include deleted users
          return users.domain(domain.uuid, true);
        })
        .then(function(list) {
          expect(list[user.uuid].deleted_at).to.be.instanceof(Date);
          expect(list[user2.uuid].deleted_at).not.to.exist;
          return users.find(attr.email);
        })
        .then(function(found) {
          expect(found).to.eql(user2);
          done();
        })
        .catch(done);
    })

  })
});
