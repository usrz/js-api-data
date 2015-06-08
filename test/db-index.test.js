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
            foo: 'dfb0c114-f376-509a-89dd-4a09c6bb3a4f',
            baz: '448c77fc-ce36-585f-9030-d23ee7f8600f'
          });
          return index.index(scope2, owner1, attributes); // different scope
        })

        // Same attributes, different scope
        .then(function(result) {
          expect(result).to.eql({
            foo: '6554b7c2-e798-566d-af6e-8bbcce7ca008',
            baz: 'a43e0582-c1c3-56f6-8192-b0fa02dc0e72'
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
            foo: 'ed56dc61-7cc3-53b6-aff6-9b0b2dd2d7bc',
            baz: '3fe33ae1-2b4e-5e4d-a7bb-03a863d5918c'
          });
          return client.read('SELECT "scope", "owner", "keyid", "value" FROM "objects_index"');
        })

        // Check all results!
        .then(function(result) {
          expect(result.rows.length).to.equal(6);
          expect(result.rows).to.deep.include.members([
            { scope: scope1, owner: owner1, keyid: '894eb3b4-09d7-54a9-b0f6-00119e9f484f', value: 'dfb0c114-f376-509a-89dd-4a09c6bb3a4f' }, // foo:bar
            { scope: scope1, owner: owner1, keyid: 'ed56dc61-7cc3-53b6-aff6-9b0b2dd2d7bc', value: '448c77fc-ce36-585f-9030-d23ee7f8600f' }, // baz:123

            { scope: scope1, owner: owner2, keyid: '894eb3b4-09d7-54a9-b0f6-00119e9f484f', value: 'ed56dc61-7cc3-53b6-aff6-9b0b2dd2d7bc' }, // foo:baz
            { scope: scope1, owner: owner2, keyid: 'ed56dc61-7cc3-53b6-aff6-9b0b2dd2d7bc', value: '3fe33ae1-2b4e-5e4d-a7bb-03a863d5918c' }, // baz:321

            { scope: scope2, owner: owner1, keyid: '4944c962-5a16-5846-a2a7-c17a0336f064', value: '6554b7c2-e798-566d-af6e-8bbcce7ca008' }, // foo:baz
            { scope: scope2, owner: owner1, keyid: '6120402b-841e-542e-a843-2a0962a7dc0d', value: 'a43e0582-c1c3-56f6-8192-b0fa02dc0e72' }  // baz:321
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
          expect(result).to.eql({ unscoped: 'f80c3628-2790-5bca-8d6f-b17dc28f0c6f' });
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
          expect(result).to.eql({ unscoped: '9dd507a5-68ce-5820-8501-7ad9c0b8b815' });
          return client.read('SELECT "owner", "keyid", "value" FROM "objects_index" WHERE "scope" IS NULL');
        })
        .then(function(result) {
          expect(result.rows.length).to.equal(2);
          expect(result.rows).to.deep.include.members([
            { owner: owner1, keyid: '4fc77daa-1ef0-530b-9df7-3d15e6461884', value: 'f80c3628-2790-5bca-8d6f-b17dc28f0c6f' }, // unscoped:yes
            { owner: owner2, keyid: '4fc77daa-1ef0-530b-9df7-3d15e6461884', value: '9dd507a5-68ce-5820-8501-7ad9c0b8b815' }  // unscoped:123
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
