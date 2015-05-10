'use strict';

const util = require('util');
const validate = require("validate.js");
validate.Promise = Promise;

// Custom "type" validator using Node's "util.isXXX(...)"
validate.validators.type = function(value, options) {
  if (options === 'array')     return (util.isArray(value)           ? null : "must be an array");
  if (options === 'boolean')   return (util.isBoolean(value)         ? null : "must be a boolean");
  if (options === 'buffer')    return (util.isBuffer(value)          ? null : "must be a Buffer");
  if (options === 'date')      return (util.isDate(value)            ? null : "must be a Date");
  if (options === 'error')     return (util.isError(value)           ? null : "must be an Error");
  if (options === 'function')  return (util.isFunction(value)        ? null : "must be a function");
  if (options === 'null')      return (util.isNullOrUndefined(value) ? null : "must be null or undefined");
  if (options === 'number')    return (util.isNumber(value)          ? null : "must be a number");
  if (options === 'object')    return (util.isObject(value)          ? null : "must be an object");
  if (options === 'primitive') return (util.isPrimitive(value)       ? null : "must be a primitive");
  if (options === 'regexp')    return (util.isRegExp(value)          ? null : "must be a regular expression");
  if (options === 'string')    return (util.isString(value)          ? null : "must be a string");
  if (options === 'symbol')    return (util.isSymbol(value)          ? null : "must be a symbol");
  return `has an unknown validation type "${options}"`;
};

// Custom "domain" validator
const domain_expr = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
validate.validators.domain = function(value, options) {
  if (! util.isString(value)) return "must be a string";
  if (domain_expr.exec(value)) return null;
  return "is not a valid domain name";
}

/* ========================================================================== *
 * VALIDATION ERROR CLASS                                                     *
 * ========================================================================== */

class ValidationError extends Error {
  constructor(object, errors) {
    super('Object failed to validate');
    Error.captureStackTrace(this, ValidationError);
    this.validation = errors;
    this.object = object;
  };
};

ValidationError.prototype.message = 'Object failed to validate';
ValidationError.prototype.name = 'ValidationError';

/* ========================================================================== *
 * VALIDATOR CLASS                                                            *
 * ========================================================================== */

class Validator {
  constructor(constraints) {
    if (! util.isObject(constraints)) throw new Error("Invalid or missing constraints");
    this.constraints = constraints;
  }

  validate(object) {
    if (! util.isObject(object)) throw new Error('Invalid or missing object to validate');
    var errors = validate(object, this.constraints);
    if (errors == null) return object;
    throw new ValidationError(object, errors);
  }
}

/* ========================================================================== *
 * MODULE EXPORTS                                                            *
 * ========================================================================== */

Validator.ValidationError = ValidationError;
exports = module.exports = Validator;
