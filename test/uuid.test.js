'use strict';

var expect = require('chai').expect;
var UUID = require('../src/uuid');

describe.only('UUID', function() {

  describe('UUID class', function() {

    describe('constructor', function() {

      it('should construct with a string', function() {
        var uuid = new UUID('DF64783F-9EDB-42B5-82C6-721E6354E7C4');
        expect(uuid.variant).to.equal('RFC-4122');
        expect(uuid.version).to.equal(4);
        expect(uuid.toString()).to.equal('df64783f-9edb-42b5-82c6-721e6354e7c4');
      });

      it('should construct with a buffer', function() {
        var uuid = new UUID(new Buffer('DF64783F9EDB42B582C6721E6354E7C4', 'hex'));
        expect(uuid.variant).to.equal('RFC-4122');
        expect(uuid.version).to.equal(4);
        expect(uuid.toString()).to.equal('df64783f-9edb-42b5-82c6-721e6354e7c4');
      });

      it('should construct with a UUID', function() {
        var uuid1 = new UUID('DF64783F-9EDB-42B5-82C6-721E6354E7C4');
        var uuid2 = new UUID(uuid1);

        expect(uuid2.variant).to.equal('RFC-4122');
        expect(uuid2.version).to.equal(4);
        expect(uuid2.toString()).to.equal('df64783f-9edb-42b5-82c6-721e6354e7c4');

        // Should return a *DIFFERENT* instance
        expect(uuid2).not.to.equal(uuid1);
        expect(uuid2).to.eql(uuid1);
      });
    });

    describe('creator function', function() {

      it('should construct with a string', function() {
        var uuid = UUID('DF64783F-9EDB-42B5-82C6-721E6354E7C4');
        expect(uuid.variant).to.equal('RFC-4122');
        expect(uuid.version).to.equal(4);
        expect(uuid.toString()).to.equal('df64783f-9edb-42b5-82c6-721e6354e7c4');
      });

      it('should construct with a buffer', function() {
        var uuid = UUID(new Buffer('DF64783F9EDB42B582C6721E6354E7C4', 'hex'));
        expect(uuid.variant).to.equal('RFC-4122');
        expect(uuid.version).to.equal(4);
        expect(uuid.toString()).to.equal('df64783f-9edb-42b5-82c6-721e6354e7c4');
      });

      it('should construct with a UUID', function() {
        var uuid1 = UUID('DF64783F-9EDB-42B5-82C6-721E6354E7C4');
        var uuid2 = UUID(uuid1);

        expect(uuid2.variant).to.equal('RFC-4122');
        expect(uuid2.version).to.equal(4);
        expect(uuid2.toString()).to.equal('df64783f-9edb-42b5-82c6-721e6354e7c4');

        // Should return *THE SAME* instance
        expect(uuid2).to.equal(uuid1);
      });
    });

    describe('non-RFC variants', function() {

      it('should construct a NCS-RESERVED UUID', function() {
        var uuid = UUID('00000000-0000-0000-0000-000000000000');
        expect(uuid.variant).to.equal('NCS-RESERVED');
        expect(uuid.version).to.equal(null);
        expect(uuid.toString()).to.equal('00000000-0000-0000-0000-000000000000');
      });

      it('should construct a MICROSOFT-RESERVED UUID', function() {
        var uuid = UUID('00000000-0000-0000-C000-000000000000');
        expect(uuid.variant).to.equal('MICROSOFT-RESERVED');
        expect(uuid.version).to.equal(null);
        expect(uuid.toString()).to.equal('00000000-0000-0000-c000-000000000000');
      });

      it('should construct a RESERVED UUID', function() {
        var uuid = UUID('00000000-0000-0000-E000-000000000000');
        expect(uuid.variant).to.equal('RESERVED');
        expect(uuid.version).to.equal(null);
        expect(uuid.toString()).to.equal('00000000-0000-0000-e000-000000000000');
      });
    });

    describe('coercion to RFC UUID', function() {

      it('should return the same UUID for a RFC-4122 UUID without specifying a version', function() {
        var uuid1 = new UUID('DF64783F-9EDB-42B5-82C6-721E6354E7C4');
        var uuid2 = uuid1.coerceRFC();
        expect(uuid1).to.equal(uuid2);
      });

      it('should return the same UUID for a RFC-4122 UUID specifying the same version', function() {
        var uuid1 = new UUID('DF64783F-9EDB-42B5-82C6-721E6354E7C4');
        var uuid2 = uuid1.coerceRFC(4);
        expect(uuid1).to.equal(uuid2);
      });

      it('should return a new UUID for a RFC-4122 UUID specifying a different version', function() {
        var uuid1 = new UUID('DF64783F-9EDB-42B5-82C6-721E6354E7C4');
        var uuid2 = uuid1.coerceRFC(0);
        expect(uuid1).to.not.equal(uuid2);
        expect(uuid2.variant).to.equal('RFC-4122');
        expect(uuid2.version).to.equal(0);
        expect(uuid2.toString()).to.equal('df64783f-9edb-02b5-82c6-721e6354e7c4');
      });

      it('should return a new UUID for a non-RFC-4122 UUID without specifying a version', function() {
        var uuid1 = new UUID('00000000-0000-0000-0000-000000000000');
        var uuid2 = uuid1.coerceRFC();
        expect(uuid1).to.not.equal(uuid2);
        expect(uuid2.variant).to.equal('RFC-4122');
        expect(uuid2.version).to.equal(0);
        expect(uuid2.toString()).to.equal('00000000-0000-0000-8000-000000000000');
      });

      it('should return a new UUID for a non-RFC-4122 UUID specifying a version', function() {
        var uuid1 = new UUID('00000000-0000-0000-0000-000000000000');
        var uuid2 = uuid1.coerceRFC(15);
        expect(uuid1).to.not.equal(uuid2);
        expect(uuid2.variant).to.equal('RFC-4122');
        expect(uuid2.version).to.equal(15);
        expect(uuid2.toString()).to.equal('00000000-0000-f000-8000-000000000000');
      });
    });

    describe('bitwise operations', function() {

      it('should AND two UUIDs', function() {
        var uuid1 = new UUID('5c653bbd-be69-4523-94a1-83f1fa2bda3e');
        var uuid2 = new UUID('634bcaf2-c327-4d87-b7cc-a9a48f28e715');
        var uuid3 = uuid1.and(uuid2);

        expect(uuid3.toString()).to.equal('40410ab0-8221-4503-9480-81a08a28c214');
      });

      it('should OR two UUIDs', function() {
        var uuid1 = new UUID('b3a1225c-8e79-4a10-9285-c5046c57649c');
        var uuid2 = new UUID('6f982beb-578b-454b-9438-7cbc5627303a');
        var uuid3 = uuid1.or(uuid2);

        expect(uuid3.toString()).to.equal('ffb92bff-dffb-4f5b-96bd-fdbc7e7774be');
      });

      it('should NOT an UUID', function() {
        var uuid1 = new UUID('01859d46-e360-431b-ac7f-12ffb5971a41');
        var uuid2 = uuid1.not();

        expect(uuid2.toString()).to.equal('fe7a62b9-1c9f-bce4-5380-ed004a68e5be');
      });

      it('should XOR two UUIDs', function() {
        var uuid1 = new UUID('94b6187a-d6cb-44c6-a018-b21de017d57a');
        var uuid2 = new UUID('08d66379-6340-4aa4-b302-4fb40871c6fb');
        var uuid3 = uuid1.xor(uuid2);

        expect(uuid3.toString()).to.equal('9c607b03-b58b-0e62-131a-fda9e8661381');
      });
    });
  });

  describe('static methods', function() {

    it('should create a V1 UUID discovering the MAC address', function() {
      var string = UUID.v1();
      var uuid = new UUID(string);

      expect(uuid.toString()).to.equal(string);
      expect(uuid.variant).to.equal('RFC-4122');
      expect(uuid.version).to.equal(1);
    });

    it('should create a V1 UUID with a specified MAC address', function() {
      var string = UUID.v1('01:02:03:04:05:06');
      var uuid = new UUID(string);

      expect(uuid.toString()).to.equal(string);
      expect(uuid.variant).to.equal('RFC-4122');
      expect(uuid.version).to.equal(1);
      expect(string).to.match(/-010203040506$/);
    });

    it('should create a V2 UUID discovering user ID and MAC address', function() {
      var string = UUID.v2();
      var uuid = new UUID(string);

      expect(uuid.toString()).to.equal(string);
      expect(uuid.variant).to.equal('RFC-4122');
      expect(uuid.version).to.equal(2);
      expect(string).to.match(new RegExp('^0*' + process.getuid().toString(16) + '-'));
      expect(uuid.toBuffer()[9]).to.equal(0);
    });

    it('should create a V2 UUID with a specified group ID, type and MAC address', function() {
      var string = UUID.v2(0x12345678, true, '01:02:03:04:05:06');
      var uuid = new UUID(string);

      expect(uuid.toString()).to.equal(string);
      expect(uuid.variant).to.equal('RFC-4122');
      expect(uuid.version).to.equal(2);
      expect(uuid.toBuffer()[9]).to.equal(1);
      expect(string).to.match(/^12345678-....-....-....-010203040506$/);
    });

    it('should create a V3 UUID', function() {
      var namespace = new UUID('a600a8df-c915-46af-bbd1-b5dbcee4edaa');
      var uuid = UUID.v3(namespace, 'foobarbaz');
      expect(uuid).to.equal('541a7718-ba03-3c51-8b0f-d04b493744a9');
    });

    it('should create a V4 UUID with a secure random', function() {
      var string = UUID.v4(true);
      var uuid = new UUID(string);

      expect(uuid.toString()).to.equal(string);
      expect(uuid.variant).to.equal('RFC-4122');
      expect(uuid.version).to.equal(4);
    });

    it('should create a V4 UUID with a pseudo random', function() {
      var string = UUID.v4(false);
      var uuid = new UUID(string);

      expect(uuid.toString()).to.equal(string);
      expect(uuid.variant).to.equal('RFC-4122');
      expect(uuid.version).to.equal(4);
    });

    it('should create a V5 UUID', function() {
      var namespace = new UUID('d32ef1b5-56ee-40d6-a415-0b3080e212b3');
      var uuid = UUID.v5(namespace, 'foobarbaz');
      expect(uuid).to.equal('845637e9-875c-5d18-9ed6-4d479ad4bff8');
    });
  });
});
