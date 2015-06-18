'use strict';

const util = require('util');

// Merge stack trace from cause
function mergeStack(error, cause) {
  if (! cause) return;
  var stack = error.stack || error.toString();
  if (util.isError(cause)) {
    stack += '\n  Caused by ' + (cause.stack || cause.toString());
  } else {
    stack += '\n  Caused by [' + typeof (cause) + '] ' + cause.toString();
  }
  Object.defineProperty(error, 'stack', {
    enumerable:   false,
    configurable: true, // leave configurable
    value:        stack
  });
}

/* ========================================================================== *
 * DB CLIENT ERROR, WRAPS ANOTHER ERROR NICELY                                *
 * ========================================================================== */

class ClientError extends Error {
  constructor(message, cause) {
    super(message);

    /* Our properties */
    if (message) this.message = message;
    if (cause) this.cause = cause;

    /* Capture our stack trace and marge */
    Error.captureStackTrace(this, ClientError);
    if (cause) mergeStack(this, cause);
  };
}

ClientError.prototype.message = 'Database Error';
ClientError.prototype.name = 'ClientError';

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = ClientError;
