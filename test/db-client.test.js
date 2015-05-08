'use strict';

const expect = require('chai').expect;
const DbClient = require('../src/db-client');
const url = "postgres://localhost/postgres";

describe('Database Client', function() {

  it('should run a simple query', function(done) {
    var results = [];
    var queries = [];
    var client = new DbClient(url);
    client.on('acquired', queries.push.bind(queries, 'acquired'));
    client.on('released', queries.push.bind(queries, 'released'));
    client.on('query', queries.push.bind(queries, 'query'));
    client.on('exception', queries.push.bind(queries, 'exception'));

    client.query("SELECT 1 AS num")
      .then(function(one) {
        results.push(one.rows[0].num);
      })
    .then(function() {
      expect(results).to.eql([1]);
      expect(queries).to.eql([
        'acquired',
        'query', 'SELECT 1 AS num', [],
        'released'
      ]);
      done();
    })
    .catch(done);
  });

  it('should handle misconnections', function(done) {
    var results = [];
    var queries = [];
    var client = new DbClient('postgres://localhost:9999/foo');
    client.on('acquired', queries.push.bind(queries, 'acquired'));
    client.on('released', queries.push.bind(queries, 'released'));
    client.on('query', queries.push.bind(queries, 'query'));
    client.on('exception', queries.push.bind(queries, 'exception'));

    client.query("SELECT 1 AS num")
      .then(function(one) {
        results.push(one.rows[0].num);
      })
    .catch(function(error) {
      expect(error.name).to.equal('DbError');
      expect(error.message).to.equal('Error connecting to postgres://localhost:9999/foo');
      expect(error.cause).to.be.instanceof(Error);
      expect(error.cause.message).to.match(/ECONNREFUSED/);

      expect(results).to.eql([]);
      expect(queries).to.eql([
        'exception', error.cause,
      ]);

      done();
    })
    .catch(done);
  });

  /* ======================================================================== *
   * CONNECTIONS TEST                                                         *
   * ======================================================================== */

  describe('Connections', function() {

    it('should interrupt a promise chain on SQL error', function(done) {
      this.slow(300);

      var results = [];
      var queries = [];
      var client = new DbClient(url);
      client.on('acquired', queries.push.bind(queries, 'acquired'));
      client.on('released', queries.push.bind(queries, 'released'));
      client.on('query', queries.push.bind(queries, 'query'));
      client.on('exception', queries.push.bind(queries, 'exception'));

      client.connect(function (query) {
        return query("SELECT 1 AS num")
        .then(function(one) {
          results.push(one.rows[0].num);
          return query("SELECT 2 AS num")
        })
        .then(function(two) {
          results.push(two.rows[0].num);
          return new Promise(function (resolve, reject) {
            setTimeout(function() {
              resolve(query("SELECT 3 AS num"));
            }, 100);
          });
        })
        .then(function(three) {
          results.push(three.rows[0].num);
          return query("XELECT 4 AS num")
        })
        .then(function(four) {
          results.push(four.rows[0].num);
          return query("SELECT 5 AS num")
        })
        .then(function(five) {
          results.push(five.rows[0].num);
        })
      })

      .then(function() {
        throw new Error("Promise was resolved?");
      })

      .catch(function(error) {
        expect(error.name).to.equal('DbError');
        expect(error.message).to.equal('Error executing query "XELECT 4 AS num" with 0 parameters');
        expect(error.cause).to.be.instanceof(Error);
        expect(error.cause.message).to.match(/XELECT/);

        expect(results).to.eql([1, 2, 3]);
        expect(queries).to.eql([
          'acquired',
          'query', 'SELECT 1 AS num', [],
          'query', 'SELECT 2 AS num', [],
          'query', 'SELECT 3 AS num', [],
          'exception', error.cause,
          'released'
        ]);

        done();
      })

      .catch(done)
    });

    it('should interrupt a promise chain on user error', function(done) {
      this.slow(300);

      var results = [];
      var queries = [];
      var client = new DbClient(url);
      client.on('acquired', queries.push.bind(queries, 'acquired'));
      client.on('released', queries.push.bind(queries, 'released'));
      client.on('query', queries.push.bind(queries, 'query'));
      client.on('exception', queries.push.bind(queries, 'exception'));

      client.connect(function (query) {
        return query("SELECT 1 AS num")
        .then(function(one) {
          results.push(one.rows[0].num);
          return query("SELECT 2 AS num")
        })
        .then(function(two) {
          results.push(two.rows[0].num);
          return new Promise(function (resolve, reject) {
            setTimeout(function() {
              resolve(query("SELECT 3 AS num"));
            }, 100);
          });
        })
        .then(function(three) {
          results.push(three.rows[0].num);
          throw new Error('No, this will not work');
        })
        .then(function(four) {
          results.push(four.rows[0].num);
          return query("SELECT 5 AS num")
        })
        .then(function(five) {
          results.push(five.rows[0].num);
        })
      })

      .then(function() {
        throw new Error("Promise was resolved?");
      })

      .catch(function(error) {
        expect(error.name).to.equal('Error');
        expect(error.message).to.equal('No, this will not work');

        expect(results).to.eql([1, 2, 3]);
        expect(queries).to.eql([
          'acquired',
          'query', 'SELECT 1 AS num', [],
          'query', 'SELECT 2 AS num', [],
          'query', 'SELECT 3 AS num', [],
          'released'
        ]);

        done();
      })

      .catch(done)
    });


    it('should run multiple chained queries', function(done) {
      this.slow(300);

      var results = [];
      var queries = [];
      var client = new DbClient(url);
      client.on('acquired', queries.push.bind(queries, 'acquired'));
      client.on('released', queries.push.bind(queries, 'released'));
      client.on('query', queries.push.bind(queries, 'query'));
      client.on('exception', queries.push.bind(queries, 'exception'));

      client.connect(function (query) {
        return query("SELECT 1 AS num")
        .then(function(one) {
          results.push(one.rows[0].num);
          return query("SELECT 2 AS num")
        })
        .then(function(two) {
          results.push(two.rows[0].num);
          return new Promise(function (resolve, reject) {
            setTimeout(function() {
              resolve(query("SELECT 3 AS num"));
            }, 100);
          });
        })
        .then(function(three) {
          results.push(three.rows[0].num);
          return query("SELECT 4 AS num")
        })
        .then(function(four) {
          results.push(four.rows[0].num);
          return query("SELECT 5 AS num")
        })
        .then(function(five) {
          results.push(five.rows[0].num);
        })
      })
      .then(function() {
        expect(results).to.eql([1, 2, 3, 4, 5]);
        expect(queries).to.eql([
          'acquired',
          'query', 'SELECT 1 AS num', [],
          'query', 'SELECT 2 AS num', [],
          'query', 'SELECT 3 AS num', [],
          'query', 'SELECT 4 AS num', [],
          'query', 'SELECT 5 AS num', [],
          'released'
        ]);

        done();
      })
      .catch(done);
    });
  });

  /* ======================================================================== *
   * TRANSACTIONS TEST                                                        *
   * ======================================================================== */

  describe('Transactions', function() {
    it('should interrupt a promise chain on SQL error', function(done) {
      this.slow(300);

      var results = [];
      var queries = [];
      var client = new DbClient(url);
      client.on('acquired', queries.push.bind(queries, 'acquired'));
      client.on('released', queries.push.bind(queries, 'released'));
      client.on('query', queries.push.bind(queries, 'query'));
      client.on('exception', queries.push.bind(queries, 'exception'));

      client.transaction(function (query) {
        return query("SELECT 1 AS num")
        .then(function(one) {
          results.push(one.rows[0].num);
          return query("SELECT 2 AS num")
        })
        .then(function(two) {
          results.push(two.rows[0].num);
          return new Promise(function (resolve, reject) {
            setTimeout(function() {
              resolve(query("SELECT 3 AS num"));
            }, 100);
          });
        })
        .then(function(three) {
          results.push(three.rows[0].num);
          return query("XELECT 4 AS num")
        })
        .then(function(four) {
          results.push(four.rows[0].num);
          return query("SELECT 5 AS num")
        })
        .then(function(five) {
          results.push(five.rows[0].num);
        })
      })

      .then(function() {
        throw new Error("Promise was resolved?");
      })

      .catch(function(error) {
        expect(error.name).to.equal('DbError');
        expect(error.message).to.equal('Error executing query "XELECT 4 AS num" with 0 parameters');
        expect(error.cause).to.be.instanceof(Error);
        expect(error.cause.message).to.match(/XELECT/);

        expect(results).to.eql([1, 2, 3]);
        expect(queries).to.eql([
          'acquired',
          'query', 'BEGIN',           [],
          'query', 'SELECT 1 AS num', [],
          'query', 'SELECT 2 AS num', [],
          'query', 'SELECT 3 AS num', [],
          'exception', error.cause,
          'query', 'ROLLBACK',        [],
          'released'
        ]);

        done();
      })

      .catch(done)
    });

    it('should interrupt a promise chain on user error', function(done) {
      this.slow(300);

      var results = [];
      var queries = [];
      var client = new DbClient(url);
      client.on('acquired', queries.push.bind(queries, 'acquired'));
      client.on('released', queries.push.bind(queries, 'released'));
      client.on('query', queries.push.bind(queries, 'query'));
      client.on('exception', queries.push.bind(queries, 'exception'));

      client.transaction(function (query) {
        return query("SELECT 1 AS num")
        .then(function(one) {
          results.push(one.rows[0].num);
          return query("SELECT 2 AS num")
        })
        .then(function(two) {
          results.push(two.rows[0].num);
          return new Promise(function (resolve, reject) {
            setTimeout(function() {
              resolve(query("SELECT 3 AS num"));
            }, 100);
          });
        })
        .then(function(three) {
          results.push(three.rows[0].num);
          throw new Error('No, this will not work');
        })
        .then(function(four) {
          results.push(four.rows[0].num);
          return query("SELECT 5 AS num")
        })
        .then(function(five) {
          results.push(five.rows[0].num);
        })
      })

      .then(function() {
        throw new Error("Promise was resolved?");
      })

      .catch(function(error) {
        expect(error.name).to.equal('Error');
        expect(error.message).to.equal('No, this will not work');

        expect(results).to.eql([1, 2, 3]);
        expect(queries).to.eql([
          'acquired',
          'query', 'BEGIN',           [],
          'query', 'SELECT 1 AS num', [],
          'query', 'SELECT 2 AS num', [],
          'query', 'SELECT 3 AS num', [],
          'query', 'ROLLBACK',        [],
          'released'
        ]);

        done();
      })

      .catch(done)
    });


    it('should run multiple chained queries', function(done) {
      this.slow(300);

      var results = [];
      var queries = [];
      var client = new DbClient(url);
      client.on('acquired', queries.push.bind(queries, 'acquired'));
      client.on('released', queries.push.bind(queries, 'released'));
      client.on('query', queries.push.bind(queries, 'query'));
      client.on('exception', queries.push.bind(queries, 'exception'));

      client.transaction(function (query) {
        return query("SELECT 1 AS num")
        .then(function(one) {
          results.push(one.rows[0].num);
          return query("SELECT 2 AS num")
        })
        .then(function(two) {
          results.push(two.rows[0].num);
          return new Promise(function (resolve, reject) {
            setTimeout(function() {
              resolve(query("SELECT 3 AS num"));
            }, 100);
          });
        })
        .then(function(three) {
          results.push(three.rows[0].num);
          return query("SELECT 4 AS num")
        })
        .then(function(four) {
          results.push(four.rows[0].num);
          return query("SELECT 5 AS num")
        })
        .then(function(five) {
          results.push(five.rows[0].num);
        })
      })
      .then(function() {
        expect(results).to.eql([1, 2, 3, 4, 5]);
        expect(queries).to.eql([
          'acquired',
          'query', 'BEGIN',           [],
          'query', 'SELECT 1 AS num', [],
          'query', 'SELECT 2 AS num', [],
          'query', 'SELECT 3 AS num', [],
          'query', 'SELECT 4 AS num', [],
          'query', 'SELECT 5 AS num', [],
          'query', 'COMMIT',          [],
          'released'
        ]);

        done();
      })
      .catch(done);
    });
  });
});
