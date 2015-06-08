/*eslint no-unused-expressions: 0*/
'use strict';

const expect = require('chai').expect;
const UUID = require('../src/uuid');

describe('Database Schema', function() {

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var client = null;

  // Set by tests
  var encryptionKey = null;
  var domain = null;
  var user = null;
  var credentials = null;

  before(testdb.before);
  before(function() {
    client = testdb.client;
  });
  after(testdb.after);

  describe('Encryption Keys', function() {

    it('should not insert a key without data', function(done) {
      client.write('INSERT INTO encryption_keys (encrypted_key) VALUES (NULL) RETURNING *')
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.match(/constraint/);
          done();
        })
        .catch(done);
    });

    it('should insert a key', function(done) {
      client.write("INSERT INTO encryption_keys (encrypted_key) VALUES ('') RETURNING *")
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.exist;
          expect(result.rows[0].encrypted_key).to.be.instanceof(Buffer);
          expect(result.rows[0].encrypted_key).to.have.length(0);
          expect(result.rows[0].created_at).to.be.instanceof(Date);
          expect(result.rows[0].deleted_at).to.be.null;

          encryptionKey = UUID.validate(result.rows[0].uuid);
          expect(encryptionKey).to.be.a('string');
          done();
        })
        .catch(done);
    });

    it('should retrieve our key', function(done) {
      if (! encryptionKey) return this.skip();

      client.write('SELECT * FROM encryption_keys WHERE uuid = $1', encryptionKey)
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.equal(encryptionKey);
          expect(result.rows[0].deleted_at).to.be.null;
          done();
        })
        .catch(done);
    });

    it('should not allow modifications', function(done) {
      if (! encryptionKey) return this.skip();

      client.write("UPDATE encryption_keys SET encrypted_key='foo' WHERE uuid = $1", encryptionKey)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.equal('Attempting to update values of encryption key "' + encryptionKey + '"');
          done();
        })
        .catch(done);
    });

    it('should allow deletions', function(done) {
      if (! encryptionKey) return this.skip();

      client.write('DELETE FROM encryption_keys WHERE uuid = $1', encryptionKey)
        .then(function(result) {
          expect(result).to.exist;
          done();
        })
        .catch(done);
    });

    it('should perform soft deletions', function(done) {
      if (! encryptionKey) return this.skip();

      client.write('SELECT * FROM encryption_keys WHERE uuid = $1', encryptionKey)
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.equal(encryptionKey);
          expect(result.rows[0].deleted_at).to.be.instanceof(Date);
          done();
        })
        .catch(done);
    });

    it('should not undelete a softly deleted key', function(done) {
      if (! encryptionKey) return this.skip();

      client.write('UPDATE encryption_keys SET deleted_at=NULL WHERE uuid = $1', encryptionKey)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.equal('Attempting to update deleted encryption key "' + encryptionKey + '"');
          done();
        })
        .catch(done);
    });

    it('should insert a key with a UUID', function(done) {
      var uuid = UUID.v4();
      client.write("INSERT INTO encryption_keys (uuid, encrypted_key) VALUES ($1, '') RETURNING uuid", uuid)
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.equal(uuid);
          encryptionKey = uuid;
          done();
        })
        .catch(done);
    });
  });

  describe('Encrypted Object (Basics)', function() {

    it('should not insert an object without encryption_key', function(done) {
      client.write("INSERT INTO objects (kind, encrypted_data) VALUES ('domain', '') RETURNING *")
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.match(/constraint/);
          done();
        })
        .catch(done);
    });

    it('should not insert an object without encrypted data', function(done) {
      client.write("INSERT INTO objects (kind, encryption_key) VALUES ('domain', $1) RETURNING *", encryptionKey)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.match(/constraint/);
          done();
        })
        .catch(done);
    });

    it('should not insert an object without kind', function(done) {
      client.write("INSERT INTO objects (encryption_key, encrypted_data) VALUES ($1, '') RETURNING *", encryptionKey)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.message).to.match(/Error executing query/);
          done();
        })
        .catch(done);
    });

    it('should insert a domain', function(done) {
      if (! encryptionKey) return this.skip();

      client.write("INSERT INTO objects (kind, encryption_key, encrypted_data) VALUES ('domain', $1, '') RETURNING *", encryptionKey)
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.exist;
          expect(result.rows[0].kind).to.equal('domain');
          expect(result.rows[0].parent).to.equal(result.rows[0].uuid);
          expect(result.rows[0].encryption_key).to.equal(encryptionKey);
          expect(result.rows[0].encrypted_data).to.eql(new Buffer(0));
          expect(result.rows[0].created_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at.getTime()).to.equal(result.rows[0].created_at.getTime());

          domain = UUID.validate(result.rows[0].uuid);
          expect(domain).to.be.a('string');
          done();
        })
        .catch(done);
    });

    it('should not allow modifications of the UUID', function(done) {
      if (! encryptionKey) return this.skip();
      if (! domain) return this.skip();

      client.write('UPDATE objects SET uuid=$1 WHERE uuid = $2', UUID.v4(), domain)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.equal('Attempting to update protected object values for key "' + domain + '"');
          done();
        })
        .catch(done);
    });

    it('should not allow modifications of the object kind', function(done) {
      if (! encryptionKey) return this.skip();
      if (! domain) return this.skip();

      client.write("UPDATE objects SET kind='user' WHERE uuid = $1", domain)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.equal('Attempting to update protected object values for key "' + domain + '"');
          done();
        })
        .catch(done);
    });

    it('should not allow modifications of the object parent', function(done) {
      if (! encryptionKey) return this.skip();
      if (! domain) return this.skip();

      client.write("UPDATE objects SET parent='f4ae40d3-ff69-4ee2-8c69-d9a41d4fe6c3' WHERE uuid = $1", domain)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.equal('Attempting to update protected object values for key "' + domain + '"');
          done();
        })
        .catch(done);
    });

    it('should not allow modifications of the object key without data changes', function(done) {
      if (! encryptionKey) return this.skip();
      if (! domain) return this.skip();

      client.write("UPDATE objects SET encryption_key='f4ae40d3-ff69-4ee2-8c69-d9a41d4fe6c3' WHERE uuid = $1", domain)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.equal('Attempting to update encryption key but not data for key "' + domain + '"');
          done();
        })
        .catch(done);
    });

    it('should allow modifications of the encrypted data', function(done) {
      if (! encryptionKey) return this.skip();
      if (! domain) return this.skip();

      client.write("UPDATE objects SET encrypted_data='foobar' WHERE uuid = $1 RETURNING *", domain)
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.equal(domain);
          expect(result.rows[0].kind).to.equal('domain');
          expect(result.rows[0].parent).to.equal(result.rows[0].uuid);
          expect(result.rows[0].encryption_key).to.equal(encryptionKey);
          expect(result.rows[0].encrypted_data).to.eql(new Buffer('foobar'));
          expect(result.rows[0].created_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at.getTime()).not.to.equal(result.rows[0].created_at.getTime());
          done();
        })
        .catch(done);
    });

    it('should allow deletions', function(done) {
      if (! encryptionKey) return this.skip();
      if (! domain) return this.skip();

      client.write('DELETE FROM objects WHERE uuid = $1 RETURNING *', domain)
        .then(function(result) {
          expect(result).to.exist;
          done();
        })
        .catch(done);
    });

    it('should perform soft deletions', function(done) {
      if (! encryptionKey) return this.skip();
      if (! domain) return this.skip();

      client.write('SELECT * FROM objects WHERE uuid = $1', domain)
        .then(function(result) {
          expect(result.rows).to.have.length(0);
          return client.write('SELECT * FROM deleted_objects WHERE uuid = $1', domain);
        })
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.equal(domain);
          expect(result.rows[0].deleted_at).to.be.instanceof(Date);
          return client.write('SELECT * FROM available_objects WHERE uuid = $1', domain);
        })
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.equal(domain);
          expect(result.rows[0].deleted_at).to.be.instanceof(Date);

          // Recreate new
          return client.write("INSERT INTO objects (kind, encryption_key, encrypted_data) VALUES ('domain', $1, '') RETURNING *", encryptionKey);
        })
        .then(function(result) {
          expect(result.rows[0].uuid).to.exist;
          domain = UUID.validate(result.rows[0].uuid);
          expect(domain).to.be.a('string');
          done();
        })
        .catch(done);
    });
  });

// TODO indexes here!!!!

  describe('Encrypted Object (Hieararchy)', function() {

    it('should insert a user for a domain', function(done) {
      if (! encryptionKey) return this.skip();

      client.write("INSERT INTO objects (kind, parent, encryption_key, encrypted_data) VALUES ('user', $1, $2, '') RETURNING *", domain, encryptionKey)
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.exist;
          expect(result.rows[0].kind).to.equal('user');
          expect(result.rows[0].parent).to.equal(domain);
          expect(result.rows[0].encryption_key).to.equal(encryptionKey);
          expect(result.rows[0].encrypted_data).to.eql(new Buffer(0));
          expect(result.rows[0].created_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at.getTime()).to.equal(result.rows[0].created_at.getTime());

          user = UUID.validate(result.rows[0].uuid);
          expect(user).to.be.a('string');
          done();
        })
        .catch(done);
    });

    it('should not insert credentials for a domain', function(done) {
      if (! encryptionKey) return this.skip();

      client.write("INSERT INTO objects (kind, parent, encryption_key, encrypted_data) VALUES ('credentials', $1, $2, '') RETURNING *", domain, encryptionKey)
        .then(function() {
          throw new Error('Should not work');
        }, function(error) {
          expect(error.cause.message).to.equal('Parent "' + domain + '" can not have children of kind "credentials"');
          done();
        })
        .catch(done);
    });

    it('should insert credentials for a user', function(done) {
      if (! encryptionKey) return this.skip();

      client.write("INSERT INTO objects (kind, parent, encryption_key, encrypted_data) VALUES ('credentials', $1, $2, '') RETURNING *", user, encryptionKey)
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          expect(result.rows[0].uuid).to.exist;
          expect(result.rows[0].kind).to.equal('credentials');
          expect(result.rows[0].parent).to.equal(user);
          expect(result.rows[0].encryption_key).to.equal(encryptionKey);
          expect(result.rows[0].encrypted_data).to.eql(new Buffer(0));
          expect(result.rows[0].created_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at).to.be.instanceof(Date);
          expect(result.rows[0].updated_at.getTime()).to.equal(result.rows[0].created_at.getTime());

          credentials = UUID.validate(result.rows[0].uuid);
          expect(credentials).to.be.a('string');
          done();
        })
        .catch(done);
    });

    it('should delete recursively from a domain', function(done) {
      client.write('DELETE FROM objects WHERE parent=$1', domain)

        // Check on the main "objects" table

        .then(function(result) {
          expect(result).to.exist;
          return client.write('SELECT * FROM objects WHERE uuid = $1', domain);
        })
        .then(function(result) {
          expect(result.rows).to.have.length(0);
          return client.write('SELECT * FROM objects WHERE uuid = $1', user);
        })
        .then(function(result) {
          expect(result.rows).to.have.length(0);
          return client.write('SELECT * FROM objects WHERE uuid = $1', credentials);
        })

        // Check on the "deleted_objects" table

        .then(function(result) {
          expect(result).to.exist;
          return client.write('SELECT * FROM deleted_objects WHERE uuid = $1', domain);
        })
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          return client.write('SELECT * FROM deleted_objects WHERE uuid = $1', user);
        })
        .then(function(result) {
          expect(result.rows).to.have.length(1);
          return client.write('SELECT * FROM deleted_objects WHERE uuid = $1', credentials);
        })

        // Credentials are NEVER copied to "deleted_objects"

        .then(function(result) {
          expect(result.rows).to.have.length(0);
          done();
        })
        .catch(done);
    });
  });
});

