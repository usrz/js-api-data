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

            // Index email address (use global_scope), username and uid
            return inst.index.index(nil, user.uuid, { email: user.email }, query)
              .then(function(indexed) {
                // Return the user we created
                return user;
              });
          });
      });
  }
}

exports = module.exports = Users;
