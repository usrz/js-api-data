'use strict';

const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const DbStore = require('../src/db-store');

describe.only('Database Store', function() {

  const parent = '00000000-0000-0000-0000-000000000000';
  var file1 = require('path').resolve(__dirname, '../ddl.sql');
  var file2 = require('path').resolve(__dirname, './ddl/db-store.test.sql');
  var ddl1 = require('fs').readFileSync(file1).toString('utf8');
  var ddl2 = require('fs').readFileSync(file2).toString('utf8');
  var testdb = require('./testdb')(ddl1 + ddl2);
  var store = null;
  var value = null;

  var attributes1 = {hello: "world", foobar: 123, object: {a: 1, b: "B"}};
  var attributes2 = {foobar: null, gonzo: 456, object: {b: null, c: 999}};
  var attributes3 = {hello: "world", gonzo: 456, object: {a: 1, c: 999}};

  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    store = new DbStore('test_store', keyManager, testdb.client);
  })
  after(testdb.after);

  it('should not fetch an invalid uuid', function(done) {
    store.select('mario')
      .then(function(value) {
        expect(value).to.be.null;
        return store.exists('mario');
      })
      .then(function(exists) {
        expect(exists).to.be.false;
        done();
      })
      .catch(done);
  })

  it('should return null fetching an unknown value', function(done) {
    store.select('78adc7c5-e021-4507-81c3-51ee579c4bb4')
      .then(function(value) {
        expect(value).to.be.null;
        return store.exists('78adc7c5-e021-4507-81c3-51ee579c4bb4');
      })
      .then(function(exists) {
        expect(exists).to.be.false;
        done();
      })
      .catch(done);
  })

  it('should save a new value', function(done) {
    store.insert(parent, attributes1)
      .then(function(created) {
        expect(created).to.exist;
        expect(created.uuid).to.be.a('string');
        expect(created.parent).to.equal(parent);
        expect(created.created_at).to.be.instanceof(Date);
        expect(created.updated_at).to.be.instanceof(Date);
        expect(created.created_at.getTime()).to.equal(created.updated_at.getTime());
        expect(created.deleted_at).to.be.null;
        expect(created.attributes).to.eql(attributes1);
        value = created;
        done();
      })
      .catch(done);
  })

  it('should find our saved value', function(done) {
    if (! value) return this.skip();
    store.select(value.uuid)
      .then(function(found) {
        expect(found).to.eql(value);
        return store.exists(value.uuid);
      })
      .then(function(exists) {
        expect(exists).to.be.true;
        done();
      })
      .catch(done);
  })

  it('should update our saved value', function(done) {
    if (! value) return this.skip();
    store.update(value.uuid, attributes2)
      .then(function(modified) {
        expect(modified).to.exist;
        expect(modified.uuid).to.equal(value.uuid);
        expect(modified.parent).to.equal(value.parent);
        expect(modified.updated_at).to.be.instanceof(Date);
        expect(modified.created_at.getTime()).to.equal(value.created_at.getTime());
        expect(modified.created_at.getTime()).not.to.equal(modified.updated_at.getTime());
        expect(modified.deleted_at).to.be.null;
        expect(modified.attributes).to.eql(attributes3);
        value = modified;
        done();
      })
      .catch(done);
  })

  it('should delete our saved value', function(done) {
    if (! value) return this.skip();
    store.delete(value.uuid)
      .then(function(deleted) {
        expect(deleted).to.exist;
        expect(deleted.uuid).to.equal(value.uuid);
        expect(deleted.parent).to.equal(value.parent);
        expect(deleted.updated_at).to.be.instanceof(Date);
        expect(deleted.deleted_at).to.be.instanceof(Date);
        expect(deleted.created_at.getTime()).to.equal(value.created_at.getTime());
        expect(deleted.updated_at.getTime()).to.equal(deleted.deleted_at.getTime());
        expect(deleted.created_at.getTime()).not.to.equal(deleted.updated_at.getTime());
        expect(deleted.attributes).to.eql(attributes3);
        value = deleted;
        done();
      })
      .catch(done);
  })

  it('should not return our deleted value by default', function(done) {
    if (! value) return this.skip();
    store.select(value.uuid)
      .then(function(found) {
        expect(found).to.be.null;
        return store.exists(value.uuid);
      })
      .then(function(exists) {
        expect(exists).to.be.false;
        done();
      })
      .catch(done);
  })

  it('should not return our value when not including deleted', function(done) {
    if (! value) return this.skip();
    store.select(value.uuid, false)
      .then(function(found) {
        expect(found).to.be.null;
        done();
      })
      .catch(done);
  })


  it('should return our value when including deleted', function(done) {
    if (! value) return this.skip();
    store.select(value.uuid, true)
      .then(function(found) {
        expect(found).to.eql(value);
        done();
      })
      .catch(done);
  })

});
