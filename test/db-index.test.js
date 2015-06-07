/*eslint no-unused-expressions: 0*/
'use strict';

const expect = require('chai').expect;

const KeyManager = require('../src/key-manager');
const DbIndex = require('../src/db-index');

describe('Database Index', function() {

  const scope1 = '125036e8-d182-41a4-ad65-2a06180e7fe0';
  const scope2 = '4656dada-b495-43e8-bdce-27f3aa2096e8';
  const scopeX = '838f81ba-a1d4-4302-b5f5-43d7ebecfda0';
  const owner1 = 'b2b3cbc4-dc28-464f-a087-20bead5daf2f';
  const owner2 = '387d0c2e-554c-4063-a4fe-f829bdb7e8f8';

  const data = `INSERT INTO encryption_keys (uuid, encrypted_key)
                VALUES ('e97296d6-6143-40bd-8f29-9b5c71d6b4ee', '');
                INSERT INTO objects(uuid, kind, encryption_key, encrypted_data)
                VALUES ('${scope1}', 'domain', 'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', ''),
                       ('${scope2}', 'domain', 'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', ''),
                       ('${scopeX}', 'domain', 'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', ''),
                       ('${owner1}', 'domain', 'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', ''),
                       ('${owner2}', 'domain', 'e97296d6-6143-40bd-8f29-9b5c71d6b4ee', '')`;

  var file = require('path').resolve(__dirname, '../ddl.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl + ';\n' + data);
  var client = null;
  var index = null;

  before(testdb.before);
  before(function() {
    // Must be consistent for equality checks below!
    var key = new Buffer('WkOxuxUixRlWNZwT8vBYveHEql82Zg5d', 'utf8');
    var keyManager = new KeyManager(key, testdb.client);
    index = new DbIndex(keyManager, testdb.client);
    client = testdb.client;
  });
  after(testdb.after);

  describe('Scoped attributes', function() {
    var ok = false;

    it('should index some values', function(done) {
      var attributes = { foo: 'bar', baz: 123, gonzo: null };
      index.index(scope1, owner1, attributes)

        // Simple initial indexing
        .then(function(result) {
          expect(result).to.eql({
            foo: 'e13fde88-a80f-5d14-b34b-8c8147848c7e',
            baz: '0c22332e-850c-571b-b931-a85a1af639d6'
          });
          return index.index(scope2, owner1, attributes); // different scope
        })

        // Same attributes, different scope
        .then(function(result) {
          expect(result).to.eql({
            foo: 'b562184a-f483-5c25-b9e3-61ac3109c238',
            baz: '98fb9443-ffa0-54d4-96d9-7c73d743cd50'
          });
          return index.index(scope1, owner2, attributes); // different owner
        })


        // Same attributes, same scope, different owner
        .then(function(result) {
          console.log('Wrong result gotten', result);
          throw new Error('Should have not gotten a result');
        }, function(error) {
          expect(error.message).to.match(new RegExp(`^Duplicate values indexing attributes for "${owner2}" in scope "${scope1}"`));
          expect(error.scope).to.equal(scope1);
          expect(error.owner).to.equal(owner2);
          expect(error.duplicates.foo).to.exist;
          expect(error.duplicates.baz).to.exist;
          expect(error.duplicates.foo.uuid).to.eql(owner1);
          expect(error.duplicates.baz.uuid).to.eql(owner1);
          return index.index(scope1, owner2, { foo: 'baz', baz: 321 }); // different values
        })

        // Different values after error above
        .then(function(result) {
          expect(result).to.eql({
            foo: '5e5e64c5-eaaa-5ad3-a635-1dbf0300e3b1',
            baz: '9cd8bf58-997d-5b40-8c7a-608d0b7a13b9'
          });
          return client.read('SELECT "scope", "owner", "keyid", "value" FROM "objects_index"');
        })

        // Check all results!
        .then(function(result) {
          expect(result.rows.length).to.equal(6);
          expect(result.rows).to.deep.include.members([
            { scope: scope1, owner: owner1, keyid: '64f75b35-1097-5a01-9c3c-fb3fbb4a86b6', value: 'e13fde88-a80f-5d14-b34b-8c8147848c7e' }, // foo:bar
            { scope: scope1, owner: owner1, keyid: '3704fe2c-9416-5ff3-a8c0-c757517c16e1', value: '0c22332e-850c-571b-b931-a85a1af639d6' }, // baz:123

            { scope: scope1, owner: owner2, keyid: '64f75b35-1097-5a01-9c3c-fb3fbb4a86b6', value: '5e5e64c5-eaaa-5ad3-a635-1dbf0300e3b1' }, // foo:baz
            { scope: scope1, owner: owner2, keyid: '3704fe2c-9416-5ff3-a8c0-c757517c16e1', value: '9cd8bf58-997d-5b40-8c7a-608d0b7a13b9' }, // baz:321

            { scope: scope2, owner: owner1, keyid: 'ecba84ef-00c5-5da6-af7c-1e5133c585cb', value: 'b562184a-f483-5c25-b9e3-61ac3109c238' }, // foo:baz
            { scope: scope2, owner: owner1, keyid: '7db6fb55-7e7f-5299-a6fb-ffadd7f23043', value: '98fb9443-ffa0-54d4-96d9-7c73d743cd50' }  // baz:321
          ]);
          ok = true;
          done();
        })
        .catch(done);
    });

    it('should find the correct values', function(done) {
      if (! ok) return this.skip();

      index.find(scope1, 'foo', 'bar' )
        .then(function(result) {
          expect(result).to.exist;
          expect(result.uuid).to.equal(owner1);
          return index.find(scope1, 'foo', 'baz');
        })
        .then(function(result) {
          expect(result).to.exist;
          expect(result.uuid).to.equal(owner2);
          return index.find(scope1, 'baz', 123);
        })
        .then(function(result) {
          expect(result).to.exist;
          expect(result.uuid).to.equal(owner1);
          return index.find(scope1, 'baz', 321);
        })
        .then(function(result) {
          expect(result).to.exist;
          expect(result.uuid).to.equal(owner2);
          return index.find(scope2, 'foo', 'bar');
        })
        .then(function(result) {
          expect(result).to.exist;
          expect(result.uuid).to.equal(owner1);
          return index.find(scope2, 'foo', 'baz');
        })
        .then(function(result) {
          expect(result).to.be.null;
          done();
        })
        .catch(done);
    });

    it('should search the correct values', function(done) {
      if (! ok) return this.skip();

      index.search(scope1, 'foo')
        .then(function(result) {
          expect(result.length).to.equal(2);
          expect([ result[0].uuid, result[1].uuid ])
            .to.include.members([ owner1, owner2 ]);
          return index.search(scope1, 'baz');
        })
        .then(function(result) {
          expect(result.length).to.equal(2);
          expect([ result[0].uuid, result[1].uuid ])
            .to.include.members([ owner1, owner2 ]);
          return index.search(scope2, 'foo');
        })
        .then(function(result) {
          expect(result.length).to.equal(1);
          expect(result[0].uuid).to.equal(owner1);
          return index.search(scope1, 'bar');
        })
        .then(function(result) {
          expect(result.length).to.equal(0);
          done();
        })
        .catch(done);
    });
  });

  describe('Global (null-scoped) attributes', function() {
    var ok = false;

    it('should index some unscoped attributes', function(done) {
      var attributes = { unscoped: 'yes' };
      index.index(null, owner1, attributes)
        .then(function(result) {
          expect(result).to.eql({ unscoped: '30772fb3-e9cb-52ca-a04d-bfbc071be980' });
          return index.index(null, owner2, attributes); // different owner
        })
        .catch(function(error) {
          expect(error.message).to.match(new RegExp(`^Duplicate values indexing attributes for "${owner2}" in NULL scope`));
          expect(error.scope).to.equal(null);
          expect(error.owner).to.equal(owner2);
          expect(error.duplicates.unscoped).to.exist;
          expect(error.duplicates.unscoped.uuid).to.equal(owner1);
          return index.index(null, owner2, { unscoped: 123 }); // different values (reindex)
        })
        .then(function(result) {
          expect(result).to.eql({ unscoped: '28d9b93b-7604-5600-b08e-92c93ee8fda3' });
          return client.read('SELECT "owner", "keyid", "value" FROM "objects_index" WHERE "scope" IS NULL');
        })
        .then(function(result) {
          expect(result.rows.length).to.equal(2);
          expect(result.rows).to.deep.include.members([
            { owner: owner1, keyid: '7d34c128-ef7f-54d2-afb8-67a799b0a439', value: '30772fb3-e9cb-52ca-a04d-bfbc071be980' }, // unscoped:yes
            { owner: owner2, keyid: '7d34c128-ef7f-54d2-afb8-67a799b0a439', value: '28d9b93b-7604-5600-b08e-92c93ee8fda3' }  // unscoped:123
          ]);
          ok = true;
          done();
        })
        .catch(done);
    });

    it('should find the correct unscoped values', function(done) {
      if (! ok) return this.skip();

      index.find(null, 'unscoped', 'yes' )
        .then(function(result) {
          expect(result).to.exist;
          expect(result.uuid).to.equal(owner1);
          return index.find(null, 'unscoped', '123');
        })
        .then(function(result) {
          expect(result).to.exist;
          expect(result.uuid).to.equal(owner2);
          done();
        })
        .catch(done);
    });
  });
});
