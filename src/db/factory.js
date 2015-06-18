'use strict';

/* ========================================================================== *
 * "SIMPLE" STORE                                                             *
 * ========================================================================== */

class Factory {
  constructor(store, kind) {
    Object.defineProperties(this, {
      'client': { enumerable: false, configurable: false, value: store.client },
      'store':  { enumerable: false, configurable: false, value: store },
      'kind':   { enumerable: false, configurable: false, value: kind }
    });
  }

  get( /* uuid, includeDeleted, query */ ) {
    var self = this;
    return this.store.select.apply(this.store, arguments)
      .then(function(object) {
        if (object && (object.kind === self.kind)) return object;
        return null;
      });
  }

  delete(uuid, query) {
    var self = this;

    // Do not use "self.get()" as we'll get extended for sure!
    function deleteKind(transaction) {
      return self.store.select(uuid, false, transaction)
        .then(function(object) {
          if (object && (object.kind === self.kind)) {
            return self.store.delete(uuid, transaction);
          } else {
            return null;
          }
        });
    }

    // Execute all in a transaction
    if (query) return deleteKind(query);
    return this.client.transaction(function(transaction) {
      return deleteKind(transaction);
    });
  }

  create( /* parent, attributes, query */ ) {
    // Prepend our kind to the parent and invoke insert
    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(this.kind);
    return this.store.insert.apply(this.store, args);
  }

  modify(uuid, attributes, query) {
    var self = this;

    // Do not use "self.get()" as we'll get extended for sure!
    function modifyKind(transaction) {
      return self.store.select(uuid, false, transaction)
        .then(function(object) {
          if (object && (object.kind === self.kind)) {
            return self.store.update(uuid, attributes, transaction);
          } else {
            return null;
          }
        });
    }

    // Execute all in a transaction
    if (query) return modifyKind(query);
    return this.client.transaction(function(transaction) {
      return modifyKind(transaction);
    });
  }
}

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = Factory;
