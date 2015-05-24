'use strict'

const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const Domains = require('../src/domains');

describe.skip('Domains', function() {

  var file = require('path').resolve(__dirname, '../ddl2.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var domains = null;
  var domain = null;
  var attr = null;

  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    domains = new Domains(keyManager, testdb.client);
  })
  after(testdb.after);

  describe('Creation', function() {

    it('should not create an invalid domain', function(done) {
      domains.create({})
        .then(function(domain) {
          throw new Error('It should not have been created');
        }, function(error) {
          expect(error.details[0].message).to.equal('"name" is required');
          expect(error.details[0].path).to.equal('name');
          expect(error.details[1].message).to.equal('"domain_name" is required');
          expect(error.details[1].path).to.equal('domain_name');
          done();
        })
        .catch(done);
    });

    it('should not create with a invalid properties', function(done) {
      domains.create({ name: 123, domain_name: "phony" })
        .then(function(domain) {
          throw new Error('It should not have been created');
        }, function(error) {
          expect(error.details[0].message).to.equal('"name" must be a string');
          expect(error.details[0].path).to.equal('name');
          expect(error.details[1].message).to.match(/"domain_name" with value "phony" fails to match/);
          expect(error.details[1].path).to.equal('domain_name');
          done();
        })
        .catch(done);
    });

    it('should create a valid domain', function(done) {
      domains.create({ name: " Test \n Domain \t ", domain_name: "example.com" })
        .then(function(created) {
          // Same UUID (parent of self!)
          expect(created.uuid).to.equal(created.parent);
          return created.attributes()
            .then(function(attributes) {
              expect(attributes).to.eql({
                name: "Test Domain",
                domain_name: "example.com"
              });
              domain = created;
              attr = attributes;
              done();
          })
        })
        .catch(done);
    });
  })

  describe('Checks', function() {
    before(function() { if (! domain) this.skip() });

    it('should retrieve the created domain', function(done) {
      domains.get(domain.uuid)
        .then(function(gotten) {
          expect(gotten).to.eql(domain);
          return gotten.attributes()
            .then(function(attributes) {
              expect(attributes).to.eql(attr);
              done();
            })
        })
        .catch(done);
    });

    it('should not modify and invalidate a domain', function(done) {
      domains.modify(domain.uuid, { domain_name: 'phony' })
        .then(function(modified) {
          throw new Error("Domain was modified");
        }, function(error) {
          expect(error.details[0].message).to.match(/"domain_name" with value "phony" fails to match/);
          expect(error.details[0].path).to.equal('domain_name');

          // Triple check
          return domains.get(domain.uuid);
        })
        .then(function(gotten) {
          expect(gotten).to.eql(domain);
          return gotten.attributes()
            .then(function(attributes) {
              expect(attributes).to.eql(attr);
              done();
            })
        })
        .catch(done);
    })

    it('should delete our created domain', function(done) {
      domains.delete(domain.uuid)
        .then(function(deleted) {
          expect(deleted.deleted_at).to.be.instanceof(Date);
          return deleted.attributes()
            .then(function(attributes) {
              expect(attributes).to.eql(attr);
              domain = deleted;
              attr = attributes;

              // Triple check
              return domains.get(domain.uuid);
            })
        })
        .then(function(gotten) {
          expect(gotten).to.be.null;

          // Still accessible forcedly
          return domains.get(domain.uuid, true);
        })
        .then(function(gotten) {
          expect(gotten).to.eql(domain);
          return gotten.attributes()
            .then(function(attributes) {
              expect(attributes).to.eql(attr);
              done();
            })
        })
        .catch(done);
    });
  });
});
