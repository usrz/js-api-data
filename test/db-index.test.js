'use strict';

const expect = require('chai').expect;
const DbIndex = require('../src/db-index');

describe('Database Index', function() {

  const scope1 = '125036e8-d182-41a4-ad65-2a06180e7fe0';
  const scope2 = '4656dada-b495-43e8-bdce-27f3aa2096e8';
  const owner1 = 'b2b3cbc4-dc28-464f-a087-20bead5daf2f';
  const owner2 = '387d0c2e-554c-4063-a4fe-f829bdb7e8f8';
  var file = require('path').resolve(__dirname, './ddl/db-index.test.sql');
  var ddl = require('fs').readFileSync(file).toString('utf8');
  var testdb = require('./testdb')(ddl);
  var client = null;
  var index = null;

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
        expect(result.length).to.equal(2);
        expect(result).to.include('b12a133a-65ea-5e79-a846-a540b4cc2d89');
        expect(result).to.include('03b1fb8c-bd70-59bf-b79e-e41a6ffed9c0');
        return index.index(scope2, owner1, attributes); // different scope
      })
      .then(function(result) {
        expect(result.length).to.equal(2);
        expect(result).to.include('93a8d45e-1795-598c-a7a0-fa7016a86190');
        expect(result).to.include('ca323926-cfc2-5149-afbc-f542c7aa393d');
        return index.index(scope1, owner2, attributes); // different owner
      })
      .catch(function(error) {
        expect(error.cause.message).to.match(/unique constraint "test_index_pkey"/);
        return(index.index(scope1, owner2, { foo: "baz", baz: 321 })); // different values
      })
      .then(function(result) {
        expect(result.length).to.equal(2);
        expect(result).to.include('b552e0dd-33a0-5b95-8631-9fbe748c9f92');
        expect(result).to.include('d3287628-11e6-52c5-ab8c-4a685fffcdce');
        return client.query('SELECT "scope", "owner", "value" FROM "test_index"');
      })
      .then(function(result) {
        expect(result.rows.length).to.equal(6);
        expect(result.rows).to.deep.include.members([
          { scope: scope1, owner: owner1, value: 'b12a133a-65ea-5e79-a846-a540b4cc2d89' },
          { scope: scope1, owner: owner1, value: '03b1fb8c-bd70-59bf-b79e-e41a6ffed9c0' },
          { scope: scope1, owner: owner2, value: 'b552e0dd-33a0-5b95-8631-9fbe748c9f92' },
          { scope: scope1, owner: owner2, value: 'd3287628-11e6-52c5-ab8c-4a685fffcdce' },
          { scope: scope2, owner: owner1, value: '93a8d45e-1795-598c-a7a0-fa7016a86190' },
          { scope: scope2, owner: owner1, value: 'ca323926-cfc2-5149-afbc-f542c7aa393d' },
        ]);
        done();
      })
      .catch(done);
  });

  it('should find the correct values', function(done) {
    index.find(scope1, { foo: "bar" })
      .then(function(result) {
        expect(result.length).to.equal(1);
        expect(result[0]).to.equal(owner1);
        return index.find(scope1, { foo: "baz" })
      })
      .then(function(result) {
        expect(result.length).to.equal(1);
        expect(result[0]).to.equal(owner2);
        return index.find(scope1, { foo: "bar", baz: 321 })
      })
      .then(function(result) {
        expect(result.length).to.equal(2);
        expect(result).to.include.members([ owner1, owner2 ]);
        return index.find(scope1, { gonzo: "xyz" }); // not strict
      })
      .then(function(result) {
        expect(result.length).to.equal(0);
        done();
      })
      .catch(done);
  });

});
