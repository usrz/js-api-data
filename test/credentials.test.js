'use strict';

var Credentials = require('../src/credentials');

var expect = require('chai').expect;
var crypto = require('crypto');

describe('Credentials', function() {

  var credentials = null;

  it('should create some credentials', function() {
    credentials = new Credentials('password');

    expect(credentials.kdf_spec).to.eql({
      algorithm:          'PBKDF2',
      hash:               'SHA-1',
      iterations:         100000,
      derived_key_length: 20
    });

    expect(credentials.server_key).to.be.a('string');
    expect(credentials.server_key.length).to.equal(44);
    expect(credentials.stored_key).to.be.a('string');
    expect(credentials.stored_key.length).to.equal(44);
    expect(credentials.salt).to.be.a('string');
    expect(credentials.salt.length).to.equal(28);
    expect(credentials.hash).to.equal('SHA-256');
  });

  it('should correctly compute credentials', function() {
    if (! credentials) return this.skip();

    // Validate stored information
    var key = crypto.pbkdf2Sync(new Buffer('password', 'utf8'),
                                new Buffer(credentials.salt, 'base64'),
                                credentials.kdf_spec.iterations,
                                credentials.kdf_spec.derived_key_length,
                                credentials.kdf_spec.hash.replace(/SHA-/, 'sha'));
    var hash = credentials.hash.replace(/SHA-/, 'sha');

    var serverKey = crypto.createHmac(hash, key)
                          .update(new Buffer('Server Key', 'utf8'))
                          .digest();
    var clientKey = crypto.createHmac(hash, key)
                          .update(new Buffer('Client Key', 'utf8'))
                          .digest();
    var storedKey = crypto.createHash(hash)
                          .update(clientKey)
                          .digest();

    // Check computed values encodings...
    expect(credentials.stored_key).to.equal(storedKey.toString('base64'));
    expect(credentials.server_key).to.equal(serverKey.toString('base64'));
  });
});
