'use strict';

var morgan = require('morgan');
var uuid = require('uuid');

// Instrument a request with a unique UUID.
function requestId() {
  return function requestIdHandler(req, res, next) {
    // Existing in request, inherited from header or create ID
    var id = req.id || req.get("X-Request-ID") || uuid.v4();
    if (! req.id) req.id = id;
    next();
  }
}

// Let Morgan know about our request ID
morgan.token('request_id', function(req) {
  return req.id;
})

// Use morgan with a nice format for access logs
function accessLog() {
  return morgan(':date[iso] [:remote-addr] ":method :url HTTP/:http-version" :status :res[content-length] :response-time (:uuid)');
}

function logErrors() {
  return [
    function notFoundHandler(req, res, next) {
      next({status: 404, message: "Not Found"});
    }, require('./errorLog');
  ];
}







exports = module.exports = {
  requestId: requestId,
  accessLog: accessLog,
  logErrors: logErrors
};

