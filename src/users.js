 'use strict';

const Credentials = require('./credentials');
const db = require('./db');

const joi = require('joi');

const schema = joi.object({
  name:        joi.string().required().replace(/\s+/g, ' ').trim().min(1).max(1024),
  email:       joi.string().required().email().max(1024),
  credentials: joi.object({
    kdf_spec:   joi.object().unknown(true),
    server_key: joi.string().min(32, 'base64').max(1024, 'base64'),
    stored_key: joi.string().min(32, 'base64').max(1024, 'base64'),
    salt:       joi.string().min(20, 'base64').max(1024, 'base64'),
    hash:       joi.string().regex(/^SHA-(256|384|512)$/)
  }),
  posix_name: joi.string().regex(/^[a-z_][a-z0-9\._-]*\$?$/).trim().lowercase().min(1).max(32),
  posix_uid:  joi.number().integer().min(1).max(0x7FFFFFFF),
  posix_gid:  joi.number().integer().min(1).max(0x7FFFFFFF)
}).and('posix_uid', 'posix_gid', 'posix_name');

const INDEX = Symbol('index');

class Users extends db.Factory {
  constructor(keyManager, client) {

    // Local variables for the constructor
    var store = new db.Store(keyManager, client, validator, indexer);
    var index = new db.Indexer(keyManager, client);
    super(store, 'user');

    // A function that will validate the attributes
    function validator(attributes, query, parent) {

      // First of all validate the parent!
      return store.select(parent, 'domain', false, query)
        .then(function(result) {
          if (! result) throw new Error('Invalid parent ' + parent);

          // Convert any password to credentials
          if (attributes.password) {
            attributes.credentials = new Credentials(attributes.password);
            delete attributes.password;
          }

          // Find the parent, must be a domain (not deleted)
          try {
            var validation = joi.validate(attributes, schema, {abortEarly: false});
            if (validation.error) return Promise.reject(validation.error);
            return Promise.resolve(validation.value);
          } catch (error) {
            return Promise.reject(error);
          }
        });
    }

    // A function that will index the attributes
    function indexer(attributes, query, object) {

      // Our array of promises
      var promises = [];

      // Index email in "null" (global) scope
      promises.push(index.index(null, object.uuid, {
          email: attributes.email
        }, query));

      // Index email also in the domain, plus posix attributes.
      promises.push(index.index(object.parent, object.uuid, {
          email:      attributes.email,
          posix_name: attributes.posix_name,
          posix_uid:  attributes.posix_uid,
          posix_gid:  attributes.posix_gid
        }, query));

      // Combine our promises
      return Promise.all(promises);
    }

    // Remember those for the methods below
    this[INDEX] = index;
  }

  find(email, query) {
    var self = this;

    // Potentially, this might be called from a transaction
    if (! query) {
      return this.client.read(function(read) {
        return self.find(email, read);
      });
    }

    // Find the user by email
    return self[INDEX].find(null, 'email', email, query);
  }

  domain(domain, includeDeleted, query) {
    return this.store.parent(domain, 'user', includeDeleted, query);
  }

}

exports = module.exports = Users;
