 'use strict';

const Credentials = require('./credentials');
const DbStore = require('./db-store');
const DbIndex = require('./db-index');
const Domains = require('./domains');

const nil = require('./uuid').NULL.toString();

const joi = require('joi');


const validator = joi.object({
  name: joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
  email: joi.string().required().email().max(1024),
  credentials: joi.object({
    kdf_spec: joi.object().unknown(true),
    server_key: joi.string().min(32, 'base64').max(1024, 'base64'),
    stored_key: joi.string().min(32, 'base64').max(1024, 'base64'),
    stored_key: joi.string().min(32, 'base64').max(1024, 'base64'),
    salt: joi.string().min(20, 'base64').max(1024, 'base64'),
    hash: joi.string().regex(/^SHA-(256|384|512)$/)
  }),
  uid: joi.number().integer().min(1).max(0x7FFFFFFF),
  gid: joi.number().integer().min(1).max(0x7FFFFFFF),
  user_name: joi.string().replace(/\s+/g, ' ').trim().min(1).max(64)
}).and('uid', 'gid', 'user_name');

const DOMAINS = Symbol('domains');
const CLIENT = Symbol('client');
const STORE = Symbol('store');
const INDEX = Symbol('index');

class Users {
  constructor(keyManager, client) {
    this[CLIENT] = client;
    this[STORE] = new DbStore('users', keyManager, client, validator);
    this[INDEX] = new DbIndex('users_index', client);
    this[DOMAINS] = new Domains(keyManager, client);
  }

  get(uuid, include_deleted) {
    return this[STORE].select(uuid, include_deleted);
  }

  find(email) {
    var self = this;

    // Reuse connection
    return self[CLIENT].read(function(query) {
      return self[INDEX].find(nil, 'email', email, query)
        .then(function(uuid) {
          if (! uuid) return null;

          return self[STORE].select(uuid, true, query) // yes, include deleted
            .then(function(user) {
              if (user.deleted_at) throw new Error(`Found deleted user "${uuid}"`);
              return user;
          })
      })
    })
  }

  domain(domain, include_deleted, query) {
    return this[STORE].parent(domain, include_deleted, query);
  }

  create(domain, attributes, query) {
    var self = this;

    // Execute all in a transaction (if one was not specified)
    if (! query) return self[CLIENT].transaction(function(query) {
      return self.create(domain, attributes, query);
    });

    // Start checking if we have the domain
    return self[DOMAINS].get(domain, query)

      // Do we have the correct domain?
      .then(function(domain_object) {
        if (! domain_object) return null;

        // Should we convert a password to credentials?
        if (attributes.password) {
          attributes.credentials = new Credentials(attributes.password);
          delete attributes.password;
        }

        // Insert the user
        return self[STORE].insert(domain, attributes, query)
          .then(function(user) {
            if (! user) throw new Error('No user was created');

            // Index email address and return the user we created
            return user.attributes()
              .then(function(attributes) {
                return self[INDEX].index(nil, user.uuid, { email: attributes.email }, query)
              })
              .then(function(indexed) {
                return user;
              })
          });
      });
  }

  modify(uuid, attributes) {
    var self = this;

    return self[CLIENT].transaction(function(query) {

      // Should we convert a password to credentials?
      if (attributes.password) {
        attributes.credentials = new Credentials(attributes.password);
        delete attributes.password;
      }

      // Modify the user
      return self[STORE].update(uuid, attributes, query)
        .then(function(user) {
          if (! user) throw new Error('No user was modified');

          // Re-index email address and return the updated user
          return user.attributes()
            .then(function(attributes) {
              return self[INDEX].index(nil, user.uuid, { email: attributes.email }, query)
            })
            .then(function(indexed) {
              return user;
            });
        })
    });
  }

  delete(uuid, query) {
    var self = this;

    return this[STORE].delete(uuid, query)
      .then(function(deleted) {
        if (! deleted) return null;
        return self[INDEX].clear(nil, uuid, query)
          .then(function() {
            return deleted;
          })
      })
  }
}

exports = module.exports = Users;
