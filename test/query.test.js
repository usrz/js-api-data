var query = require('../query');
var mocha = require('mocha');
var chai = require('chai');
var expect = chai.expect;

describe('Query Builder', function() {

  it('should return a string unmodified', function() {
    var result = query.build('SELECT * FROM test');
    expect(result).to.equal('SELECT * FROM test');
  });

  it('should return an object without "WHERE" unmodfied', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test',
        values: []
      });
    expect(result).to.eql({
        name: 'test',
        text: 'SELECT * FROM test',
        values: []
      });
  })

  it('should not remove the query name without modifiers', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo=$1',
        values: [ 'bar' ],
        where: {} // this will be removed!
      });
    expect(result).to.eql({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo=$1',
        values: [ 'bar' ]
      });
  })

  it('should remove the query name with a limit', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo=$1',
        values: [ 'bar' ],
        limit: 10
      });
    expect(result).to.eql({
        text: 'SELECT * FROM test WHERE foo=$1 LIMIT $2',
        values: [ 'bar', 10 ]
      });
  })

  it('should remove the query name with an offset', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo=$1',
        values: [ 'bar' ],
        offset: 10
      });
    expect(result).to.eql({
        text: 'SELECT * FROM test WHERE foo=$1 OFFSET $2',
        values: [ 'bar', 10 ]
      });
  })

  it('should remove the query name with ordering', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo=$1',
        values: [ 'bar' ],
        order: [ 'foo', 'b a r' ]
      });
    expect(result).to.eql({
        text: 'SELECT * FROM test WHERE foo=$1 ORDER BY foo, "b a r"',
        values: [ 'bar' ]
      });
  })

  it('should prepare a very simple query with WHERE', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test',
        where: { foo: 'bar' }
      });
    expect(result).to.eql({
        text: 'SELECT * FROM test WHERE foo = $1',
        values: [ 'bar' ]
      });
  })

  it('should prepare a very simple query with AND', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo = $1',
        where: { hello: 'world' },
        values: [ 'bar' ],
      });
    expect(result).to.eql({
        text: 'SELECT * FROM test WHERE foo = $1 AND hello = $2',
        values: [ 'bar', 'world' ]
      });
  })

  it('should prepare a very simple query with AND', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo = $1',
        where: { hello: 'world' },
        values: [ 'bar' ],
      });
    expect(result).to.eql({
        text: 'SELECT * FROM test WHERE foo = $1 AND hello = $2',
        values: [ 'bar', 'world' ]
      });
  })

  it('should prepare a complex query', function() {
    var result = query.build({
        name: 'test',
        text: 'SELECT * FROM test WHERE foo = $1',
        where: {
          simple: 'simple_value',
          eq_col: { eq: 'eq_val' },
          lt_col: { lt: 'lt_val' },
          gt_col: { gt: 'gt_val' },
          like_col: { like: '%pattern%' },
          in_col_1: { in: [ 1, 2, 3, 4 ] },
          in_col_2: { in: 'in_single' }
        },
        order: [ "simple_order", { asc: "ascending" }, { desc: "descending" }],
        values: [ 'bar' ],
        offset: 10,
        limit: 20
      });
    expect(result).to.eql({
        text: 'SELECT * FROM test WHERE foo = $1'
                                + ' AND simple = $2'
                                + ' AND eq_col = $3'
                                + ' AND lt_col < $4'
                                + ' AND gt_col > $5'
                                + ' AND like_col LIKE $6'
                                + ' AND in_col_1 IN ($7, $8, $9, $10)'
                                + ' AND in_col_2 IN ($11)'
                                + ' ORDER BY simple_order, ascending ASC, descending DESC'
                                + ' OFFSET $12'
                                + ' LIMIT $13',
        values: [ 'bar', 'simple_value', 'eq_val', 'lt_val', 'gt_val', '%pattern%', 1, 2, 3, 4, "in_single", 10, 20 ]
      });
  })
});
