 'use strict';

const Credentials = require('./credentials');
const Validator = require('./validator');
const DbStore = require('./db-store');
const DbIndex = require('./db-index');
const Domains = require('./domains');

const util = require('util');

const nil = require('./uuid').NULL.toString();

var validator = new Validator({
  name: { // optional
    normalize: true,
    type: 'string'
  },
  email: { // required
    presence: true,
    email: true,
  },
  // Credentials always required!
  'credentials':            { presence: true, type: 'object' },
  'credentials.kdf_spec':   { presence: true, type: 'object' },
  'credentials.server_key': { presence: true, type: 'string' },
  'credentials.stored_key': { presence: true, type: 'string' },
  'credentials.hash':       { presence: true, type: 'string' },
  'credentials.salt':       { presence: true, type: 'string' },
})

const instances = new WeakMap();

class Users {
  constructor(keyManager, client) {
    instances.set(this, {
      client: client,
      users: new DbStore('users', keyManager, client, validator),
      index: new DbIndex('users_index', client),
      domains: new Domains(keyManager, client)
    });
  }

  get(uuid, include_deleted) {
    return instances.get(this).users.select(uuid, include_deleted);
  }

  find(email) {
    var inst = instances.get(this);
    var self = this;

    // Reuse connection
    return inst.client.read(function(query) {
      return inst.index.find(nil, 'email', email, query)
        .then(function(uuid) {
          if (! uuid) return null;

          return inst.users.select(uuid, true, query) // yes, include deleted
            .then(function(user) {
              if (user.deleted_at) throw new Error(`Found deleted user "${uuid}"`);
              return user;
          })
      })
    })
  }

  domain(domain, include_deleted, query) {
    return instances.get(this).users.parent(domain, include_deleted, query);
  }

  create(domain, attributes, query) {
    var inst = instances.get(this);
    var self = this;

    // Execute all in a transaction (if one was not specified)
    if (! query) return inst.client.transaction(function(query) {
      return self.create(domain, attributes, query);
    });

    // Start checking if we have the domain
    return inst.domains.get(domain, query)

      // Do we have the correct domain?
      .then(function(domain_object) {
        if (! domain_object) return null;

        // Should we convert a password to credentials?
        if (attributes.password) {
          attributes.credentials = new Credentials(attributes.password);
          delete attributes.password;
        }

        // Insert the user
        return inst.users.insert(domain, attributes, query)
          .then(function(user) {
            if (! user) throw new Error('No user was created');

            // Index email address and return the user we created
            return user.attributes()
              .then(function(attributes) {
                return inst.index.index(nil, user.uuid, { email: attributes.email }, query)
              })
              .then(function(indexed) {
                return user;
              })
          });
      });
  }

  modify(uuid, attributes) {
    var inst = instances.get(this);
    var self = this;

    return inst.client.transaction(function(query) {

      // Should we convert a password to credentials?
      if (attributes.password) {
        attributes.credentials = new Credentials(attributes.password);
        delete attributes.password;
      }

      // Modify the user
      return inst.users.update(uuid, attributes, query)
        .then(function(user) {
          if (! user) throw new Error('No user was modified');

          // Re-index email address and return the updated user
          return user.attributes()
            .then(function(attributes) {
              return inst.index.index(nil, user.uuid, { email: attributes.email }, query)
            })
            .then(function(indexed) {
              return user;
            });
        })
    });
  }

  delete(uuid, query) {
    var inst = instances.get(this);
    var self = this;

    return instances.get(this).users.delete(uuid, query)
      .then(function(deleted) {
        if (! deleted) return null;
        return inst.index.clear(nil, uuid, query)
          .then(function() {
            return deleted;
          })
      })
  }
}

exports = module.exports = Users;
