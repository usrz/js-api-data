'use strict';

const methods = require('methods').slice(0).concat('all');

exports = module.exports = function(router, options) {
  // Simpel check
  if (typeof router !== 'function') throw new Error('Invalid router/application');

  // Options, default "mergeParams" is true
  if (! options) options = {};
  if (! options.hasOwnProperty('mergeParams')) options.mergeParams = true;

  // Override our methods
  methods.forEach(function(method) {
    let handler = router[method];
    if (typeof handler !== 'function') return;
    router[method] = function() {

      // Get called only with one argument, return setting!
      if ((method === 'get') && (arguments.length === 1)) {
        return handler.call(router, arguments[0]);
      }

      // Wrap any other callback
      let args = [ arguments[0] ]; // start with the path
      let callbacks = Array.prototype.slice.call(arguments, 1);

      callbacks.forEach(function(callback) {
        args.push(function(req, res, next) {
          try {
            var promise = callback(req, res, next);
            if (promise) {
              if (typeof promise.catch === 'function') promise.catch(next);
              if (typeof promise.then === 'function') {
                promise.then(function(result) {
                  if (result) {
                    try {
                      res.send(result).end();
                    } catch (error) {
                      next(error);
                    }
                  }
                });
              }
            }
          } catch (error) {
            next(error);
          }
        });
      });

      // Invoke the original handler
      return handler.apply(router, args);
    };
  });

  // Return the router
  return router;
};
