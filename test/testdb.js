'use strict'

const DbClient = require('../src/db-client');
const uuid = require('../src/uuid');
const pg = require('pg');

var TestDB = exports = module.exports = function TestDB(ddl, host) {
  if (!(this instanceof TestDB)) return new TestDB(ddl, host);

  if (! host) host = 'localhost';

  var database = uuid.v4();
  var ro_user = database + "_ro";
  var rw_user = database + "_rw";

  this.ro_uri = `postgres://${ro_user}:ro_password@${host}/${database}`;
  this.rw_uri = `postgres://${rw_user}:rw_password@${host}/${database}`;
  this.client = new DbClient(this.ro_uri, this.rw_uri);

  this.before = function before(done) {
    var client = new pg.Client(`postgres://${host}/postgres`);
    client.connect(function(err) {
      if (err) return done(err);

      client.query(`CREATE DATABASE "${database}"`, function(err) {
        if (err) return done(err);
        client.query(`CREATE USER "${ro_user}" WITH PASSWORD 'ro_password'`, function(err) {
          if (err) return done(err);
          client.query(`CREATE USER "${rw_user}" WITH PASSWORD 'rw_password'`, function(err) {
            if (err) return done(err);
            client.end();

            if (! ddl) {
              console.log('    \x1B[36m\u272d\x1B[0m database "' + database + '" created');
              return done();
            }

            client = new pg.Client(`postgres://${host}/${database}`);
            client.connect(function(err) {
              if (err) return done(err);
              client.query(ddl, function(err) {
                if (err) return done(err);
                client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${rw_user}"`, function(err) {
                  if (err) return done(err);
                  client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${ro_user}"`, function(err) {
                    if (err) return done(err);
                    client.end();
                    console.log('    \x1B[36m\u272d\x1B[0m database "' + database + '" created');
                    done();
                  });
                });
              });
            });
          });
        });
      });
    })
  }.bind(this);

  this.after = function after(done) {
    pg.end(); // kill all connections
    var client = new pg.Client(`postgres://${host}/postgres`);
    client.connect(function(err) {
      if (err) return done(err);
      client.query(`DROP DATABASE "${database}"`, function(err) {
        if (err) return done(err);
        client.query(`DROP USER "${ro_user}"`, function(err) {
          if (err) return done(err);
          client.query(`DROP USER "${rw_user}"`, function(err) {
            if (err) return done(err);
            client.end();
            console.log('    \x1B[36m\u272d\x1B[0m database "' + database + '" dropped');
            done();
          });
        });
      });
    });
  }.bind(this);
}
