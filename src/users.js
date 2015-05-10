 'use strict';

const Validator = require('./validator');
const DbStore = require('./db-store');
const DbIndex = require('./db-index');
const Domains = require('./domains');

const nil = require('./uuid').NULL.toString();

var validator = new Validator({
  name: { // optional
    normalize: true,
    type: 'string'
  },
  email: { // required
    presence: true,
    email: true
  }
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

  create(domain, attributes, query) {
    var inst = instances.get(this);
    var self = this;

    // Execute all in a transaction (if one was not specified)
    if (! query) return inst.client.transaction(function(query) {
      return self.create(domain, attributes, query);
    });

    // Start checking if we have the domain
    return inst.domains.exists(domain, query)

      // Do we have the correct domain?
      .then(function(domain_exists) {
        if (! domain_exists) return null;

        // Inset the user
        return inst.users.insert(domain, attributes, query)
          .then(function(user) {
            if (! user) throw new Error('No user was inserted');

            // Index email address
            var email = user.attributes.email;
            return inst.index.index(nil, user.uuid, { email: email }, query)
              .then(function(indexed) {
                // Return the user we created
                return user;
              });
          });
      });
  }
}

exports = module.exports = Users;
