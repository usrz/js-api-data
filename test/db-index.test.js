'use strict';

const expect = require('chai').expect;
const DbIndex = require('../src/db-index');

describe.skip('Database Index', function() {

  const scope1 = '125036e8-d182-41a4-ad65-2a06180e7fe0';
  const scope2 = '4656dada-b495-43e8-bdce-27f3aa2096e8';
  const scopeX = '838f81ba-a1d4-4302-b5f5-43d7ebecfda0';
  const owner1 = 'b2b3cbc4-dc28-464f-a087-20bead5daf2f';
  const owner2 = '387d0c2e-554c-4063-a4fe-f829bdb7e8f8';
  var file1 = require('path').resolve(__dirname, '../ddl2.sql');
  var file2 = require('path').resolve(__dirname, './ddl/db-index.test.sql');
  var ddl1 = require('fs').readFileSync(file1).toString('utf8');
  var ddl2 = require('fs').readFileSync(file2).toString('utf8');
  var testdb = require('./testdb')(ddl1 + "\n" + ddl2);
  var client = null;
  var index = null;
  var ok = false;

  before(testdb.before);
  before(function() {
    index = new DbIndex('test_index', testdb.client);
    client = testdb.client;
  })
  after(testdb.after);

  it('should index some values', function(done) {
    var attributes = { foo: "bar", baz: 123, gonzo: null};
    index.index(scope1, owner1, attributes)
      .then(function(result) {
        expect(result).to.eql({
          foo: 'b12a133a-65ea-5e79-a846-a540b4cc2d89',
          baz: '03b1fb8c-bd70-59bf-b79e-e41a6ffed9c0',
        });
        return index.index(scope2, owner1, attributes); // different scope
      })
      .then(function(result) {
        expect(result).to.eql({
          foo: '93a8d45e-1795-598c-a7a0-fa7016a86190',
          baz: 'ca323926-cfc2-5149-afbc-f542c7aa393d',
        });
        return index.index(scope1, owner2, attributes); // different owner
      })
      .catch(function(error) {
        expect(error.message).to.match(new RegExp(`^Duplicate values indexing attributes for "${owner2}" in scope "${scope1}"`));
        expect(error.scope).to.equal(scope1);
        expect(error.owner).to.equal(owner2);
        expect(error.duplicates).to.eql({ foo: owner1, baz: owner1 });
        return(index.index(scope1, owner2, { foo: "baz", baz: 321 })); // different values
      })
      .then(function(result) {
        expect(result).to.eql({
          foo: 'b552e0dd-33a0-5b95-8631-9fbe748c9f92',
          baz: 'd3287628-11e6-52c5-ab8c-4a685fffcdce',
        });
        return client.read('SELECT "scope", "owner", "value" FROM "test_index"');
      })
      .then(function(result) {
        expect(result.rows.length).to.equal(6);
        expect(result.rows).to.deep.include.members([
          { scope: scope1, owner: owner1, value: 'b12a133a-65ea-5e79-a846-a540b4cc2d89' }, // foo:bar
          { scope: scope1, owner: owner1, value: '03b1fb8c-bd70-59bf-b79e-e41a6ffed9c0' }, // baz:123
          { scope: scope1, owner: owner2, value: 'b552e0dd-33a0-5b95-8631-9fbe748c9f92' }, // foo:baz
          { scope: scope1, owner: owner2, value: 'd3287628-11e6-52c5-ab8c-4a685fffcdce' }, // baz:321
          { scope: scope2, owner: owner1, value: '93a8d45e-1795-598c-a7a0-fa7016a86190' }, // foo:bar
          { scope: scope2, owner: owner1, value: 'ca323926-cfc2-5149-afbc-f542c7aa393d' }, // baz:123
        ]);
        ok = true;
        done();
      })
      .catch(done);
  });

  it('should find the correct values', function(done) {
    if (! ok) return this.skip();

    index.find(scope1, "foo", "bar" )
      .then(function(result) {
        expect(result).to.equal(owner1);
        return index.find(scope1, "foo", "baz")
      })
      .then(function(result) {
        expect(result).to.equal(owner2);
        return index.find(scope1, "baz", 123)
      })
      .then(function(result) {
        expect(result).to.equal(owner1);
        return index.find(scope1, "baz", 321)
      })
      .then(function(result) {
        expect(result).to.equal(owner2);
        return index.find(scope2, "foo", "bar")
      })
      .then(function(result) {
        expect(result).to.equal(owner1);
        return index.find(scope2, "foo", "baz")
      })
      .then(function(result) {
        expect(result).to.be.null;
        done();
      })
      .catch(done);
  });

  it('should find all scoped values', function(done) {
    if (! ok) return this.skip();

    index.scoped(scope1)
      .then(function(result) {
        expect(result).to.be.instanceof(Array);
        expect(result).to.include.members([owner1, owner2]);
        expect(result.length).to.equal(2);

        return index.scoped(scope2);
      })
      .then(function(result) {
        expect(result).to.be.instanceof(Array);
        expect(result[0]).to.equal(owner1);
        expect(result.length).to.equal(1);

        return index.scoped(scopeX);
      })
      .then(function(result) {
        expect(result).to.be.instanceof(Array);
        expect(result.length).to.equal(0);

        return index.scoped('not-a-uuid');
      })
      .then(function(result) {
        expect(result).to.be.instanceof(Array);
        expect(result.length).to.equal(0);
        done();
      })
      .catch(done);
  });

});
