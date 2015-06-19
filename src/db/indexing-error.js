'use strict';

/* ========================================================================== *
 * INDEX ERROR, WHEN DUPLICATES ARE FOUND                                     *
 * ========================================================================== */

class IndexingError extends Error {
  constructor(scope, owner, duplicates) {
    var message = `Duplicate values indexing attributes for "${owner}" in `
                + (scope ? `scope "${scope}"` : 'NULL scope');
    for (var key in duplicates) message += `\n  "${key}" owned by "${duplicates[key]}"`;
    super(message);

    /* Remember our properties */
    this.duplicates = duplicates;
    this.message = message;
    this.scope = scope;
    this.owner = owner;

    /* Capture stack */
    Error.captureStackTrace(this, IndexingError);
  };
}

IndexingError.prototype.message = 'Index Error';
IndexingError.prototype.name = 'IndexingError';

/* ========================================================================== *
 * EXPORTS                                                                    *
 * ========================================================================== */

exports = module.exports = IndexingError;
