'use strict'

const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const Domains = require('../src/domains');

describe('Domains', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var domains = null;
  var domain = null;

  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    domains = new Domains(keyManager, testdb.client);
  })
  after(testdb.after);

  it('should not create an invalid domain', function(done) {
    domains.create({})
      .then(function(domain) {
        throw new Error('It should not have been created');
      }, function(error) {
        expect(error.validation).to.eql({
          name: [ "Name can't be blank" ],
          domain_name: [ "Domain name can't be blank" ]
        });
        done();
      })
      .catch(done);
  });

  it('should not create with a invalid properties', function(done) {
    domains.create({ name: 123, domain_name: "phony" })
      .then(function(domain) {
        throw new Error('It should not have been created');
      }, function(error) {
        expect(error.validation).to.eql({
          name: [ "Name must be a string" ],
          domain_name: [ "Domain name is not a valid domain name" ]
        });
        done();
      })
      .catch(done);
  });

  it('should create a valid domain', function(done) {
    domains.create({ name: " Test \n Domain \t ", domain_name: "example.com" })
      .then(function(created) {
        // Same UUID (parent of self!)
        expect(created.uuid).to.equal(created.parent);
        expect(created.attributes).to.eql({
          name: "Test Domain",
          domain_name: "example.com"
        });
        domain = created;
        done();
      })
      .catch(done);
  });

  it('should make sure that the domain exists', function(done) {
    domains.exists(domain.uuid)
      .then(function(exists) {
        expect(exists).to.be.true;
        done();
      })
      .catch(done);
  });

  it('should retrieve the created domain', function(done) {
    domains.get(domain.uuid)
      .then(function(gotten) {
        expect(gotten).to.eql(domain);
        done();
      })
      .catch(done);
  });

  it('should not modify and invalidate a domain', function(done) {
    domains.modify(domain.uuid, { domain_name: 'phony' })
      .then(function(modified) {
        throw new Error("Domain was modified");
      }, function(error) {
        expect(error.validation).to.eql({
          domain_name: [ "Domain name is not a valid domain name" ]
        });

        // Triple check
        return domains.get(domain.uuid);
      })
      .then(function(gotten) {
        expect(gotten).to.eql(domain);
        done();
      })
      .catch(done);
  })

  it('should delete our created domain', function(done) {
    domains.delete(domain.uuid)
      .then(function(deleted) {
        expect(deleted.deleted_at).to.be.instanceof(Date);
        domain = deleted;

        // Triple check
        return domains.get(domain.uuid);
      })
      .then(function(gotten) {
        expect(gotten).to.be.null;

        // Still accessible forcedly
        return domains.get(domain.uuid, true);
      })
      .then(function(gotten) {
        expect(gotten).to.eql(domain);

        // Must not "exist"
        return domains.exists(domain.uuid);
      })
      .then(function(exists) {
        expect(exists).to.be.false;
        done();
      })
      .catch(done);
  });


});
