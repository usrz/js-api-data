'use strict';

var Credentials = require('../src/credentials');

var expect = require('chai').expect;
var crypto = require('crypto');

describe('Credentials', function() {

  var credentials = null;

  it('should create some credentials', function() {
    credentials = new Credentials('password');

    expect(credentials.kdf_spec).to.eql({
      algorithm: 'PBKDF2',
      hash: 'SHA-1',
      iterations: 100000,
      derived_key_length: 20
    });
    expect(credentials.server_key).to.be.instanceof(Buffer);
    expect(credentials.server_key.length).to.equal(32);
    expect(credentials.stored_key).to.be.instanceof(Buffer);
    expect(credentials.stored_key.length).to.equal(32);
    expect(credentials.salt).to.be.instanceof(Buffer);
    expect(credentials.salt.length).to.equal(20);
    expect(credentials.hash).to.equal('SHA-256');

    expect(new Credentials(credentials)).to.eql(credentials);
  });

  it('should correctly compute credentials', function() {
    if (! credentials) return this.skip();

    // Validate stored information
    var key = crypto.pbkdf2Sync(new Buffer('password', 'utf8'),
                                credentials.salt,
                                credentials.kdf_spec.iterations,
                                credentials.kdf_spec.derived_key_length,
                                credentials.kdf_spec.hash.replace(/SHA-/, 'sha'));
    var hash = credentials.hash.replace(/SHA-/, 'sha');

    var server_key = crypto.createHmac(hash, key)
                           .update(new Buffer('Server Key', 'utf8'))
                           .digest();
    var client_key = crypto.createHmac(hash, key)
                           .update(new Buffer('Client Key', 'utf8'))
                           .digest();
    var stored_key = crypto.createHash(hash)
                           .update(client_key)
                           .digest();

    expect(credentials.stored_key).to.eql(stored_key);
    expect(credentials.server_key).to.eql(server_key);
  });

  it('should correctly represent as a JSON object', function() {
    if (! credentials) return this.skip();

    var json = JSON.parse(JSON.stringify(credentials));
    expect(json.kdf_spec).to.eql({
      algorithm: 'PBKDF2',
      hash: 'SHA-1',
      iterations: 100000,
      derived_key_length: 20
    });
    expect(json.server_key).to.equal(credentials.server_key.toString('base64'));
    expect(json.stored_key).to.equal(credentials.stored_key.toString('base64'));
    expect(json.salt).to.equal(credentials.salt.toString('base64'));
    expect(json.hash).to.equal('SHA-256');

    expect(new Credentials(json)).to.eql(credentials);
  })
});
