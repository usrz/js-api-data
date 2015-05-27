 'use strict';

const Credentials = require('./credentials');
const DbStore = require('./db-store');
const DbIndex = require('./db-index');
const Domains = require('./domains');

const util = require('util');
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
  user_name: joi.string().regex(/^[a-z_][a-z0-9_-]*\$?$/).trim().min(1).max(32),
  posix_uid: joi.number().integer().min(1).max(0x7FFFFFFF),
  posix_gid: joi.number().integer().min(1).max(0x7FFFFFFF),
}).and('posix_uid', 'posix_gid', 'user_name');

const DOMAINS = Symbol('domains');
const CLIENT = Symbol('client');
const STORE = Symbol('store');
const INDEX = Symbol('index');

class Users {
  constructor(keyManager, client) {
    this[CLIENT] = client;
    this[STORE] = new DbStore(keyManager, client, validator);
    this[INDEX] = new DbIndex(client);
    this[DOMAINS] = new Domains(keyManager, client);
  }

  get(uuid, include_deleted, query) {
    var self = this;

    // Optional parameter
    if (util.isFunction(include_deleted)) {
      query = include_deleted;
      include_deleted = false;
    }

    // Potentially, this might be called from a transaction
    if (! query) return self[CLIENT].read(function(query) {
      return self.get(uuid, include_deleted, query);
    });

    return this[STORE].select(uuid, 'user', include_deleted, query);
  }

  find(email, query) {
    var self = this;

    // Potentially, this might be called from a transaction
    if (! query) return self[CLIENT].read(function(query) {
      return self.find(email, query);
    });

    // Find the user by email
    return self[INDEX].find(null, 'email', email, query)
      .then(function(uuid) {
        if (! uuid) return null;

        // Yes, include deleted, they should be wiped anyway
        return self[STORE].select(uuid, 'user', true, query)
          .then(function(user) {
            if (user.deleted_at) throw new Error(`Found deleted user "${uuid}"`);
            return user;
        })
    })
  }

  domain(domain, include_deleted, query) {
    return this[STORE].parent(domain, 'user', include_deleted, query);
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
        return self[STORE].insert('user', domain, attributes, query)
          .then(function(user) {
            if (! user) throw new Error('No user was created');

            // Index email address and return the user we created
            return user.attributes()
              .then(function(attributes) {
                var promises = []
                promises.push(self[INDEX].index(null, user.uuid, { email: attributes.email }, query));
                if (attributes.user_name) {
                  promises.push(self[INDEX].index(user.parent, user.uuid, {
                      user_name: attributes.user_name,
                      posix_uid: attributes.posix_uid,
                      posix_gid: attributes.posix_gid
                    }, query));
                }
                return Promise.all(promises);
              })
              .then(function(indexed) {
                return user;
              })
          });
      });
  }

  modify(uuid, attributes, query) {
    var self = this;

    // Should we convert a password to credentials?
    if (attributes.password) {
      attributes.credentials = new Credentials(attributes.password);
      delete attributes.password;
    }

    // Execute all in a transaction (if one was not specified)
    if (! query) return self[CLIENT].transaction(function(query) {
      return self.modify(uuid, attributes, query);
    });

    // Modify the user
    return self[STORE].update(uuid, attributes, query)
      .then(function(user) {
        if (! user) throw new Error('No user was modified');

        // Re-index email address and return the updated user
        return user.attributes()
          .then(function(attributes) {
            var promises = []
            promises.push(self[INDEX].index(null, user.uuid, { email: attributes.email }, query))
            if (attributes.user_name) {
              promises.push(self[INDEX].index(user.parent, user.uuid, {
                  user_name: attributes.user_name,
                  posix_uid: attributes.posix_uid,
                  posix_gid: attributes.posix_gid
                }, query));
            } else {
              promises.push(self[INDEX].clear(user.parent, user.uuid, query))
            }
            return Promise.all(promises);
          })
          .then(function(indexed) {
            return user;
          });
      })
  }

  delete(uuid, query) {
    var self = this;

    // Execute all in a transaction (if one was not specified)
    if (! query) return self[CLIENT].transaction(function(query) {
      return self.delete(uuid, query);
    });

    return this[STORE].delete(uuid, query)
      .then(function(deleted) {
        if (! deleted) return null;

        return Promise.all([
            self[INDEX].clear(null, uuid, query),
            self[INDEX].clear(deleted.parent, uuid, query)
          ])
          .then(function() {
            return deleted;
          })
      })
  }
}

exports = module.exports = Users;
