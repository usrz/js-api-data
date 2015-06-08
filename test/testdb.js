'use strict';

const DbClient = require('../src/db-client');
const uuid = require('../src/uuid');
const pg = require('pg');

exports = module.exports = function TestDB(ddl, host) {
  if (! (this instanceof TestDB)) return new TestDB(ddl, host);

  if (! host) host = 'localhost';

  var database = uuid.v4();
  var roUser = database + '_ro';
  var rwUser = database + '_rw';

  this.ro_uri = `postgres://${roUser}:ro_password@${host}/${database}`;
  this.rw_uri = `postgres://${rwUser}:rw_password@${host}/${database}`;
  this.client = new DbClient(this.ro_uri, this.rw_uri);

  this.before = function before(done) {
    pg.end();
    var client = new pg.Client(`postgres://${host}/postgres`);
    var error = function(err) {
      client.end();
      pg.end();
      done(err);
    };

    client.connect(function(err1) {
      if (err1) return error(err1);

      client.query(`CREATE DATABASE "${database}"`, function(err2) {
        if (err2) return error(err2);
        client.query(`CREATE USER "${roUser}" WITH PASSWORD 'ro_password'`, function(err3) {
          if (err3) return error(err3);
          client.query(`CREATE USER "${rwUser}" WITH PASSWORD 'rw_password'`, function(err4) {
            if (err4) return error(err4);
            client.end();

            if (! ddl) {
              console.log('    \x1B[36m\u272d\x1B[0m database "' + database + '" created');
              pg.end();
              return done();
            }

            client = new pg.Client(`postgres://${host}/${database}`);
            client.connect(function(err5) {
              if (err5) return error(err5);
              client.query(ddl, function(err6) {
                if (err6) return error(err6);
                client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${rwUser}"`, function(err7) {
                  if (err7) return error(err7);
                  client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${roUser}"`, function(err8) {
                    if (err8) return error(err8);
                    client.end();
                    pg.end();
                    console.log('    \x1B[36m\u272d\x1B[0m database "' + database + '" created');
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  };

  this.after = function after(done) {
    pg.end(); // kill all connections

    var client = new pg.Client(`postgres://${host}/postgres`);
    var error = function(err) {
      client.end();
      pg.end();
      done(err);
    };

    client.connect(function(err1) {
      if (err1) return error(err1);
      client.query(`DROP DATABASE IF EXISTS "${database}"`, function(err2) {
        if (err2) return error(err2);
        client.query(`DROP USER IF EXISTS "${roUser}"`, function(err3) {
          if (err3) return error(err3);
          client.query(`DROP USER IF EXISTS "${rwUser}"`, function(err4) {
            if (err4) return error(err4);
            client.end();
            pg.end();

            console.log('    \x1B[36m\u272d\x1B[0m database "' + database + '" dropped');
            done();
          });
        });
      });
    });
  };
};
