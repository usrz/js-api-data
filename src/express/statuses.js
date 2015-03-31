'use strict';

var statuses = require('statuses');

var byCode = {};
var byName = {};

var codes = statuses.codes;
for (var i = 0; i < codes.length; i ++) {
  var code = codes[i];
  var message = statuses[codes[i]];
  var name = message.replace(/'m/ig, ' am') // I'm a teapot :)
                    .replace(/[- \(\)]+/ig, '_')
                    .toUpperCase();

  byCode[code] = byName[name] = (function(code, message) {
    var status = function Status(msg, details) {
      // If invoked with a single object
      if (typeof(msg) === 'object') {
        details = msg;
        msg = message;
      }
      // Build up our result
      var result = { status: code, message: msg || message };
      if (details) result.details = details;
      return result;
    };

    // Add status and message
    status.status = code;
    status.message = message;
    return status;
  })(code, message);
}

byName.get = function get(status) {
  var code = Number.parseInt(status);
  if (Number.isNaN(code)) {
    return { status: 599, message: 'Not a number (' + status + ')' };
  } else if ((code < 100) || (code > 599)) {
    return { status: 599, message: 'Invalid status (' + code + ')' };
  } else {
    return byCode[code] || { status: code, message: "Unknown" };
  }
}

byName.message = function message(status) {
  return byName.get(status).message;
}

exports = module.exports = byName;
