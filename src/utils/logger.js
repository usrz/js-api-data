'use strict';

var process = require('process');
var util = require('util');
var stream = process.stdout;

function emit(name, level, args) {
  var msg = new Date().toISOString() + " " + level + " ";
  if (name) msg += name + " - ";

  if ((args.length == 1) && (args[0] instanceof Error)) {
    // Only one error, no format message, no arguments
    stream.write(msg + args[0].stack + "\n");

  } else if ((args.length > 1) && (args[args.length - 1] instanceof Error)) {

    // Normalize arguments array
    var error;
    if (Array.isArray(args)) {
      error = args.slpice(-1);
    } else {
      var array = [];
      for (var i = 0; i < args.length - 1; i ++) array.push(args[i]);
      error = args[args.length - 1];
      args = array;
    }

    // In one call, in case "stream" gets reassigned!
    stream.write(msg + util.format.apply(null, args) + "\n" + error.stack + "\n");

  } else {
    // No error, simple log message
    stream.write(msg + util.format.apply(null, args) + "\n");
  }
}

function Logger(name) {
  this.debug = function debug() { emit(name, '[DEBUG]', arguments) };
  this.info  = function info()  { emit(name, '[INFO ]', arguments) };
  this.warn  = function warn()  { emit(name, '[WARN ]', arguments) };
  this.error = function error() { emit(name, '[ERROR]', arguments) };
}

/* Create a root logger */
var root = new Logger(null);

/* Our exports */
exports = module.exports = function logger(name) {
  return new Logger(name);
}
exports.debug = function() { root.debug.apply(root, arguments) };
exports.info  = function() { root.info .apply(root, arguments) };
exports.warn  = function() { root.warn .apply(root, arguments) };
exports.error = function() { root.error.apply(root, arguments) };

Object.defineProperty(exports, 'stream', {
    enumerable: true,
    configurable: false,
    get: function get() { return stream },
    set: function set(ns) { stream = ns }
  });

