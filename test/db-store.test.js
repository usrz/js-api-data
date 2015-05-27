'use strict';

const expect = require('chai').expect;
const joi = require('joi');

const KeyManager = require('../src/key-manager');
const DbStore = require('../src/db-store');

describe('Database Store', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var parent = null;
  var store = null;
  var value = null;
  var vattr = null;

  var attributes1 = {hello: "world", foobar: 123, object: {a: 1, b: "B"}};
  var attributes2 = {foobar: null, gonzo: 456, object: {b: null, c: 999}};
  var attributes3 = {hello: "world", gonzo: 456, object: {a: 1, c: 999}};

  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    var keyManager = new KeyManager(masterKey, testdb.client);
    var validator = joi.object({
      invalid_key: joi.any().forbidden()
    }).unknown(true);

    store = new DbStore(keyManager, testdb.client, validator);
  })
  after(testdb.after);

  /* ------------------------------------------------------------------------ */

  it('should fetch null an invalid uuid', function(done) {
    store.select('mario')
      .then(function(value) {
        expect(value).to.be.null;
        done();
      })
      .catch(done);
  })

  it('should fetch null for an unknown value', function(done) {
    store.select('78adc7c5-e021-f507-81c3-51ee579c4bb4') // version "f" :-)
      .then(function(value) {
        expect(value).to.be.null;
        done();
      })
      .catch(done);
  })

  it('should not save an invalid value', function(done) {
    store.insert('validate object first', parent, { invalid_key: true })
      .then(function(created) {
        throw new Error('Created, but it should have not!')
      }, function(error) {
        expect(error).to.be.instanceof(Error);
        expect(error.details).to.be.instanceof(Array);
        expect(error.details[0].message).to.equal('"invalid_key" is not allowed');
        expect(error.details[0].path).to.equal('invalid_key');
        done();
      })
      .catch(done);
  })

  /* ------------------------------------------------------------------------ */

  it('should insert a new domain (null parent)', function(done) {
    store.insert('domain', null, {})
      .then(function(created) {
        expect(created).to.exist;
        expect(created.uuid).to.be.a('string');
        expect(created.kind).to.equal('domain');
        expect(created.parent).to.equal(created.uuid);
        expect(created.created_at).to.be.instanceof(Date);
        expect(created.updated_at).to.be.instanceof(Date);
        expect(created.created_at.getTime()).to.equal(created.updated_at.getTime());
        expect(created.deleted_at).to.be.null;
        parent = created;
        done();
      })
      .catch(done);
  });

  it('should insert a new user (domain parent)', function(done) {
    store.insert('user', parent, attributes1)
      .then(function(created) {
        expect(created).to.exist;
        expect(created.uuid).to.be.a('string');
        expect(created.kind).to.equal('user');
        expect(created.parent).to.equal(parent.uuid);
        expect(created.created_at).to.be.instanceof(Date);
        expect(created.updated_at).to.be.instanceof(Date);
        expect(created.created_at.getTime()).to.equal(created.updated_at.getTime());
        expect(created.deleted_at).to.be.null;
        return created.attributes()
          .then(function(attributes) {
            expect(attributes).to.eql(attributes1);
            value = created;
            vattr = attributes;
            done();
          })
      })
      .catch(done);
  })

  /* ------------------------------------------------------------------------ */


  it('should find our saved value', function(done) {
    if (! value) return this.skip();
    store.select(value.uuid)
      .then(function(found) {
        expect(found).to.eql(value);
        return found.attributes()
          .then(function(attributes) {
            expect(attributes).to.eql(vattr);
            done();
          })
      })
      .catch(done);
  })

  it('should find our saved value by its parent', function(done) {
    if (! value) return this.skip();
    store.parent(parent)
      .then(function(children) {
        expect(children).to.be.an('object');
        expect(children[value.uuid]).to.eql(value);
        return children[value.uuid].attributes()
          .then(function(attributes) {
            expect(attributes).to.eql(vattr);
            done();
          })
      })
      .catch(done);
  })

  it('should update our saved value', function(done) {
    if (! value) return this.skip();

    var temp = null;
    store.update(value.uuid, attributes2)
      .then(function(modified) {
        expect(modified).to.exist;
        expect(modified.uuid).to.equal(value.uuid);
        expect(modified.parent).to.equal(value.parent);
        expect(modified.updated_at).to.be.instanceof(Date);
        expect(modified.created_at.getTime()).to.equal(value.created_at.getTime());
        expect(modified.created_at.getTime()).not.to.equal(modified.updated_at.getTime());
        expect(modified.deleted_at).to.be.null;

        return modified.attributes()
          .then(function(attributes) {
            expect(attributes).to.eql(attributes3);
            value = modified;
            vattr = attributes;
            done();
          })
      })
      .catch(done);
  })

  it('should not update update if changes void validation', function(done) {
    if (! value) return this.skip();
    store.update(value.uuid, { invalid_key: true })
      .then(function(modified) {
        throw new Error('Object was invalid, but modified');
      }, function(error) {
        expect(error).to.be.instanceof(Error);
        expect(error.details).to.be.instanceof(Array);
        expect(error.details[0].message).to.equal('"invalid_key" is not allowed');
        expect(error.details[0].path).to.equal('invalid_key');

        expect(error._object.invalid_key).to.be_true;
        delete error._object.invalid_key;
        expect(error._object).to.eql(attributes3);

        // Just triple check...
        return store.select(value.uuid);
      })
      .then(function(found) {
        // Triple check that invalid key was not saved
        expect(found).to.eql(value);
        return found.attributes()
          .then(function(attributes) {
            expect(attributes).to.eql(vattr);
            done();
          })
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
        expect(deleted.updated_at.getTime()).to.equal(value.updated_at.getTime());
        expect(deleted.deleted_at.getTime()).not.to.equal(deleted.updated_at.getTime());
        return deleted.attributes()
          .then(function(attributes) {
            expect(attributes).to.eql(attributes3);
            value = deleted;
            vattr = attributes;
            done();
          })
      })
      .catch(done);
  })

  it('should not return our deleted value by default', function(done) {
    if (! value) return this.skip();
    store.select(value.uuid)
      .then(function(found) {
        expect(found).to.be.null;
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
        return found.attributes()
          .then(function(attributes) {
            expect(attributes).to.eql(vattr);
            done();
          })
      })
      .catch(done);
  })

});
