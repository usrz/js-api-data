'use strict';

const expect = require('chai').expect;
const Domains = require('../src/domains');
const KeyManager = require('../src/key-manager');
const uuid = require('../src/uuid');
const pg = require('pg');

describe('Domains', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var domains = null;
  var domain = null;

  var attributes1 = {hello: "world", foobar: 123, object: {a: 1, b: "B"}};
  var attributes2 = {foobar: null, gonzo: 456, object: {b: null, c: 999}};
  var attributes3 = {hello: "world", gonzo: 456, object: {a: 1, c: 999}};

  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    domains = new Domains(keyManager, testdb.client);
  })
  after(testdb.after);

  it('should return null fetching an invalid uuid', function(done) {
    domains.find("mario")
      .then(function(domain) {
        expect(domain).to.be.null;
        done();
      })
      .catch(done);
  })

  it('should return null fetching an unknown domain', function(done) {
    domains.find(uuid.v4())
      .then(function(domain) {
        expect(domain).to.be.null;
        done();
      })
      .catch(done);
  })

  it('should save a new domain', function(done) {
    domains.create(attributes1)
      .then(function(created) {
        expect(created).to.exist;
        expect(created.uuid).to.be.a('string');
        expect(created.uuid).to.equal(created.uuid);
        expect(created.created_at).to.be.instanceof(Date);
        expect(created.updated_at).to.be.instanceof(Date);
        expect(created.created_at.getTime()).to.equal(created.updated_at.getTime());
        expect(created.deleted_at).to.be.null;
        expect(created.attributes).to.eql(attributes1);
        domain = created;
        done();
      })
      .catch(done);
  })

  it('should find our saved domain', function(done) {
    if (! domain) return this.skip();
    domains.find(domain.uuid)
      .then(function(found) {
        expect(found).to.eql(domain);
        done();
      })
      .catch(done);
  })

  it('should update our saved domain', function(done) {
    if (! domain) return this.skip();
    domains.modify(domain.uuid, attributes2)
      .then(function(modified) {
        expect(modified).to.exist;
        expect(modified.uuid).to.be.a('string');
        expect(modified.created_at).to.be.instanceof(Date);
        expect(modified.updated_at).to.be.instanceof(Date);
        expect(modified.created_at.getTime()).not.to.equal(modified.updated_at.getTime());
        expect(modified.deleted_at).to.be.null;
        expect(modified.attributes).to.eql(attributes3);
        domain = modified;
        done();
      })
      .catch(done);
  })

  it('should delete our saved domain', function(done) {
    if (! domain) return this.skip();
    domains.delete(domain.uuid)
      .then(function(deleted) {
        expect(deleted).to.exist;
        expect(deleted.uuid).to.be.a('string');
        expect(deleted.created_at).to.be.instanceof(Date);
        expect(deleted.updated_at).to.be.instanceof(Date);
        expect(deleted.deleted_at).to.be.instanceof(Date);
        expect(deleted.attributes).to.eql(attributes3);
        domain = deleted;
        done();
      })
      .catch(done);
  })

  it('should not return our deleted domain by default', function(done) {
    if (! domain) return this.skip();
    domains.find(domain.uuid)
      .then(function(found) {
        expect(found).to.be.null;
        done();
      })
      .catch(done);
  })

  it('should not return our domain when not including deleted', function(done) {
    if (! domain) return this.skip();
    domains.find(domain.uuid, false)
      .then(function(found) {
        expect(found).to.be.null;
        done();
      })
      .catch(done);
  })


  it('should return our domain when including deleted', function(done) {
    if (! domain) return this.skip();
    domains.find(domain.uuid, true)
      .then(function(found) {
        expect(found).to.eql(domain);
        done();
      })
      .catch(done);
  })

});
