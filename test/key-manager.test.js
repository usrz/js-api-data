'use strict';

const expect = require('chai').expect;
const KeyManager = require('../src/key-manager');
const pg = require('pg');

describe('Encryption Key Manager', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var keyManager = null;
  var keys = null;

  before(testdb.before);
  before(function() {
    var masterKey = new Buffer(32).fill(0);
    keyManager = new KeyManager(masterKey, testdb.client);
  })
  after(testdb.after);

  it('should generate a few keys', function(done) {
    var promises = [];
    for (var i = 0; i < 10; i ++) {
      promises.push(keyManager.generate());
    }
    Promise.all(promises).then(function(generated) {
      expect(generated.length).to.equal(10);
      for (var i = 0; i < 10; i ++) {
        expect(generated[i].uuid).to.be.a('string');
        expect(generated[i].encrypt).to.be.a('function');
        expect(generated[i].decrypt).to.be.a('function');
        expect(generated[i].equals).to.be.a('function');
        expect(generated[i].created_at).to.be.instanceof(Date);
        expect(generated[i].deleted_at).to.be.null;
        expect(generated[i].equals(generated[i])).to.be.true;
      }
      keys = generated;
      done();
    })
    .catch(done);
  });

  it('should verify that keys do not equal each other', function() {
    if (! keys) this.skip();
    for (var i = 0; i < keys.length - 1; i++) {
      for (var j = i + 1; j < keys.length; j++) {
        expect(keys[i].equals(keys[j])).to.be.false;
      }
    }
  });

  it('should return a valid random key', function(done) {
    if (! keys) this.skip();
    keyManager.get().then(function(key) {
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].uuid == key.uuid) return done();
      }
      done(new Error('Non cached key ' + key.uuid));
    })
    .catch(done);
  });

  it('should return a valid random key across many', function(done) {
    var promises = [];
    for (var i = 0; i < 1000; i ++) {
      promises.push(keyManager.get());
    }
    Promise.all(promises).then(function(gotten) {
      expect(gotten.length).to.equal(promises.length);

      var keys = {};
      for (var i = 0; i < gotten.length; i ++) {
        expect(gotten[i].uuid).to.be.a('string');
        expect(gotten[i].deleted_at).to.be.null;
        var count = (keys[gotten[i].uuid] || 0) + 1
        keys[gotten[i].uuid] = count;
      }

      expect(Object.keys(keys).length).to.equal(10);
      //console.log('Keys Distribution: ' + JSON.stringify(keys, null, 2));
      done();
    })
    .catch(done);
  });

  it('should load the generated keys', function(done) {
    var promises = [];
    for (var i = 0; i < keys.length; i ++) {
      promises.push(keyManager.load(keys[i].uuid));
    }

    Promise.all(promises).then(function(loaded) {
      expect(loaded.length).to.equal(keys.length);
      for (var i = 0; i < keys.length; i++) {
        expect(loaded[i].uuid).to.be.a('string');
        expect(loaded[i].encrypt).to.be.a('function');
        expect(loaded[i].decrypt).to.be.a('function');
        expect(loaded[i].equals).to.be.a('function');
        expect(loaded[i].created_at).to.be.instanceof(Date);
        expect(loaded[i].deleted_at).to.be.null;

        expect(loaded[i].equals(loaded[i])).to.be.true;
        expect(loaded[i].equals(keys[i])).to.be.true;
      }
      done();
    })
    .catch(done);
  });

  it('should load the generated keys in one go', function(done) {
    keyManager.loadAll().then(function(loaded) {
      expect(loaded).to.be.an('object');
      for (var i = 0; i < keys.length; i++) {
        expect(loaded[keys[i].uuid]).to.exist;
        expect(loaded[keys[i].uuid].equals(keys[i])).to.be.true;
      }
      done();
    })
    .catch(done);
  });

  it('should delete half of the keys', function(done) {
    var promises = [];
    for (var i = 0; i < keys.length; i += 2) {
      promises.push(keyManager.delete(keys[i].uuid));
    }

    Promise.all(promises).then(function(deleted) {
      expect(deleted.length).to.equal(keys.length / 2);
      for (var i = 0; i < deleted.length; i ++) {
        expect(deleted[i].uuid).to.be.a('string');
        expect(deleted[i].encrypt).to.be.a('function');
        expect(deleted[i].decrypt).to.be.a('function');
        expect(deleted[i].equals).to.be.a('function');
        expect(deleted[i].created_at).to.be.instanceof(Date);
        expect(deleted[i].deleted_at).to.be.instanceof(Date);
      }

      done();
    })
    .catch(done);
  });

  it('should never return a deleted key when randomly getting it', function(done) {
    var promises = [];
    for (var i = 0; i < 1000; i ++) {
      promises.push(keyManager.get());
    }
    Promise.all(promises).then(function(gotten) {
      expect(gotten.length).to.equal(promises.length);

      var keys = {};
      for (var i = 0; i < gotten.length; i ++) {
        expect(gotten[i].uuid).to.be.a('string');
        expect(gotten[i].deleted_at).to.be.null;
        var count = (keys[gotten[i].uuid] || 0) + 1
        keys[gotten[i].uuid] = count;
      }

      expect(Object.keys(keys).length).to.equal(5);
      //console.log('Keys Distribution: ' + JSON.stringify(keys, null, 2));
      done();
    })
    .catch(done);
  });

  it('should always return a deleted key when directly getting it', function(done) {
    var promises = [];
    for (var i = 0; i < keys.length; i ++) {
      promises.push(keyManager.get(keys[i].uuid));
    }

    Promise.all(promises).then(function(gotten) {
      expect(gotten.length).to.equal(keys.length);
      for (var i = 0; i < gotten.length; i ++) {
        expect(gotten[i].equals(keys[i])).to.be.true;
        expect(gotten[i].deleted_at == null).to.equal(i % 2 != 0);
      }

      done();
    })
    .catch(done);
  });

  it('should create a new key when all available ones are deleted', function(done) {
    var promises = [];
    for (var i = 0; i < keys.length; i ++) {
      promises.push(keyManager.delete(keys[i].uuid));
    }

    var all_deleted_keys = null;
    Promise.all(promises).then(function(deleted) {
      expect(deleted.length).to.equal(keys.length);
      return keyManager.loadAll(); // reload all
    })
    .then(function(loaded) {
      expect(Object.keys(loaded).length).to.equal(keys.length);
      for (var i = 0; i < loaded.length; i ++) {
        expect(loaded[i].deleted_at).to.be.instanceof(Date);
      }
      all_deleted_keys = loaded;
      return keyManager.get();
    })
    .then(function(generated) {
      expect(all_deleted_keys[generated.uuid]).to.not.exist;
      expect(generated.uuid).to.be.a('string');
      expect(generated.encrypt).to.be.a('function');
      expect(generated.decrypt).to.be.a('function');
      expect(generated.equals).to.be.a('function');
      expect(generated.created_at).to.be.instanceof(Date);
      expect(generated.deleted_at).to.be.null;
      done();
    })

    .catch(done);
  });

  /* ======================================================================== */

  describe('Key Encryption', function() {
    it('should encrypt and decrypt a buffer with a key', function(done) {
      var buffer = require('crypto').randomBytes(1024);
      keyManager.get()
        .then(function(key) {
          var encrypted = key.encrypt(buffer);

          expect(encrypted.key).to.equal(key.uuid);

          var data = encrypted.data;
          expect(data).to.be.instanceof(Buffer);
          expect(data[0]).to.equal(0x01); // v1, buffer

          var decrypted = key.decrypt(data);
          expect(decrypted).to.eql(buffer);
          done();
        })
        .catch(done);
    })

    it('should encrypt and decrypt a string with a key', function(done) {
      var string = 'The quick brown fox jumped over the lazy dog!';
      keyManager.get()
        .then(function(key) {
          var encrypted = key.encrypt(string);

          expect(encrypted.key).to.equal(key.uuid);

          var data = encrypted.data;
          expect(data).to.be.instanceof(Buffer);
          expect(data[0]).to.equal(0x02); // v2, string

          var decrypted = key.decrypt(data);
          expect(decrypted).to.equal(string);
          done();
        })
        .catch(done);
    })

    it('should encrypt and decrypt a JSON object with a key', function(done) {
      var object = { number: 1, string: 'The quick brown fox jumped over the lazy dog!', boolean: true };
      keyManager.get()
        .then(function(key) {
          var encrypted = key.encrypt(object);

          expect(encrypted.key).to.equal(key.uuid);

          var data = encrypted.data;
          expect(data).to.be.instanceof(Buffer);
          expect(data[0]).to.equal(0x03); // v3, object

          var decrypted = key.decrypt(data);
          expect(decrypted).to.eql(object);
          done();
        })
        .catch(done);
    })
  })

  /* ======================================================================== */

  describe('Convenience Methods Encryption', function() {
    it('should encrypt and decrypt a buffer', function(done) {
      var buffer = require('crypto').randomBytes(1024);
      keyManager.encrypt(buffer)
        .then(function(encrypted) {
          expect(encrypted.key).to.be.a('string');

          var data = encrypted.data;
          expect(data).to.be.instanceof(Buffer);
          expect(data[0]).to.equal(0x01); // v1, buffer

          return keyManager.decrypt(encrypted.key, data);
        })
        .then(function(decrypted) {
          expect(decrypted).to.eql(buffer);
          done();
        })
        .catch(done);
    })

    it('should encrypt and decrypt a string', function(done) {
      var string = 'The quick brown fox jumped over the lazy dog!';
      keyManager.encrypt(string)
        .then(function(encrypted) {
          expect(encrypted.key).to.be.a('string');

          var data = encrypted.data;
          expect(data).to.be.instanceof(Buffer);
          expect(data[0]).to.equal(0x02); // v2, string

          return keyManager.decrypt(encrypted.key, data);
        })
        .then(function(decrypted) {
          expect(decrypted).to.equal(string);
          done();
        })
        .catch(done);
    })

    it('should encrypt and decrypt a JSON object', function(done) {
      var object = { number: 1, string: 'The quick brown fox jumped over the lazy dog!', boolean: true };
      keyManager.encrypt(object)
        .then(function(encrypted) {
          expect(encrypted.key).to.be.a('string');

          var data = encrypted.data;
          expect(data).to.be.instanceof(Buffer);
          expect(data[0]).to.equal(0x03); // v3, object

          return keyManager.decrypt(encrypted.key, data);
        })
        .then(function(decrypted) {
          expect(decrypted).to.eql(object);
          done();
        })
        .catch(done);
    });
  });
});
