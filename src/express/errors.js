'use strict';

var statuses = require('statuses');
var util = require('util');

function log(req, status, message, extra) {
  var loggable = req.id ? req.id + ' - ' : '';
  loggable += req.method + ' ' + req.originalUrl
            + ' (' + status + ') - ' + message;

  if (extra) {
    var more = util.inspect(extra);
    if (more != '{}') loggable += "\n  >>> " + more;
    if (extra instanceof Error) {
      loggable += '\n  ' + extra.stack;
    }
  }

  return loggable;
}

function create(options) {
  options = options || {};

  // Render or send JSON?
  var render = options.render || false;

  // Do we want to log? Function or stream?
  var logger = options.hasOwnProperty('logger') ? options.logger : process.stderr;
  if (logger) {
    if (typeof(logger) === 'function') {
      // A function, keep as is!
    } else if (typeof(logger.write) === 'function') {
      var stream = logger;
      logger = function(message) {
        stream.write(new Date().toISOString() + ' - ' + message + '\n');
      }
    } else {
      throw new Error("The 'logger' option must be a function or a stream");
    }
  }

  // Return our handler...
  return function handler(err, req, res, next) {
    // By default, this is a 500
    var status = 500;
    var message = statuses[500];

    // Called as "next(404)"
    if (typeof(err) === 'number') {
      if (statuses[err]) {
        message = statuses[err];
        status = err;
      }
    }

    // Called as "next('Uh-oh')"
    else if (typeof(err) === 'string') {
      message = err || message;
    }

    // Called next(...)
    else {
      // Preserve "err.status"
      if (typeof(err.status) === 'number') {
        status = err.status;
        message = statuses[status];
      } else if (err.status) {
        status = Number.parseInt(err.status);
        if (Number.isNan(status)) status = 500;
        message = statuses[status];
      }

      // Preserve "err.message"
      if (typeof(err.message) === 'string') {
        message = err.message;
      } else if (err.message) {
        message = err.message.toString();
      }
    }

    // Validate/normalize status
    if ((status < 100) || (status > 599)) status = 500;

    // Validate/normalize message
    message = message || statuses[status] || 'Unknown Error';

    // Prepare our response
    var response = {
      status: status,
      message: message,
    }

    // Inject request ID if available
    if (req.id) response.request_id = req.id;

    // Inject error details if available
    if (err.details) response.details = err.details;

    if (logger) {
      var extra;
      if (err instanceof Error) extra = err;
      else if (err.details) extra = err.details;
      logger(log(req, status, message, extra));
    }

    // Send back our response!
    if (render) {
      return res.status(status).render(response);
    } else {
      return res.status(status).json(response);
    }
  }
}

var handler = create();

exports = module.exports = function(err, req, res, next) {
  if (arguments.length == 4) return handler(err, req, res, next);
  return create(err);
}
