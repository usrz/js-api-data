'use strict';

var uuid = require('uuid');

function error(logger) {

  // At least the root logger
  if (! logger) logger = require('./logger');

  // Created by "error(req, res)"
  return function handler(error, request, response, next) {

    // ID of the request (if any or new)
    var id = request.uuid || uuid.v4();

    // Get the status
    var status = 500;
    if (typeof(error) === 'number') {
      status = error;
    } else if (typeof(error.status) === 'number') {
      status = error.status;
    }

    // Default status to 500
    if (status < 400) status = 500;

    // Compute error message
    var message = "Server error";
    switch(status) {
      case (400): message = 'Bad Request'; break;
      case (401): message = 'Unauthorized'; break;
      case (402): message = 'Payment Required'; break;
      case (403): message = 'Forbidden'; break;
      case (404): message = 'Not Found'; break;
      case (405): message = 'Method Not Allowed'; break;
      case (406): message = 'Not Acceptable'; break;
      case (407): message = 'Proxy Authentication Required'; break;
      case (408): message = 'Request Time-out'; break;
      case (409): message = 'Conflict'; break;
      case (410): message = 'Gone'; break;
      case (411): message = 'Length Required'; break;
      case (412): message = 'Precondition Failed'; break;
      case (413): message = 'Request Entity Too Large'; break;
      case (414): message = 'Request-URI Too Large'; break;
      case (415): message = 'Unsupported Media Type'; break;
      case (416): message = 'Requested Range not Satisfiable'; break;
      case (417): message = 'Expectation Failed'; break;
      case (422): message = 'Unprocessable Entity'; break;
      case (429): message = 'Too Many Requests'; break;
      case (500): message = 'Internal Server Error'; break;
      case (501): message = 'Not Implemented'; break;
      case (502): message = 'Bad Gateway'; break;
      case (503): message = 'Service Unavailable'; break;
      case (504): message = 'Gateway Time-out'; break;
      case (505): message = 'HTTP Version not Supported'; break;
    }

    // Log this error
    if (error instanceof Error) {
      logger.error('Error processing request %s for "%s"', id, request.url, error);
    } else if (typeof(error) === 'string') {
      logger.error('Error processing request %s for "%s": %s', id, request.url, error);
      message = error;
    } else if (typeof(error) !== 'number') {
      logger.error('Error processing request %s for "%s"\n%j', id, request.url, error);
      if (error.message) message = error.message;
    }

    // Return a response
    response.status(status).send({
        status: status,
        message: message,
        id: id
      });
  }
}

/* Our exports */
exports = module.exports = error;
exports.with = function(logger) {
  return error(logger);
}
