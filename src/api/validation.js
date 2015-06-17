'use strict'

const S = require('express-statuses');
const joi = require('joi');

/* Shared validation wrapper for JOI */
exports = module.exports = function validator(schema) {
  return function validate(attributes) {
    let result = joi.validate(attributes, schema, { abortEarly: false });
    if (! result.error) return result.value;

    let details = {};
    for (let cur of result.error.details) {
      let path = cur.path;
      (details[path] || (details[path] = [])).push(cur.message);
    }

    throw new S.BAD_REQUEST({error: result.error, details: details});
  }
}
