var parser = require('body-parser');
var express = require('express');
var router = new express.Router();

var domains = require('./models/domains')("postgres://127.0.0.1/usrz");

/* Parse URL-encoded forms and JSON */
router.use(parser.urlencoded({extended: true}));
router.use(parser.json());

/* Any UUID must match the RegExp before being passed, otherwise 404 the response */
var uuid_expr = /^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[89ab][0-9a-z]{3}-[0-9a-z]{12}$/i;
router.param(['domain_uuid', 'user_uuid'], function(req, res, next, uuid) {
  if (uuid_expr.test(uuid)) return next();
  res.status(404).end();
});

/* Contextualize a domain any time we see one */
router.param('domain_uuid', function(req, res, next, uuid) {
  domains.get(req.params.domain_uuid)
    .then(function(domain) {
      if (!domain) return next(404);
      req.domain = domain;
      return next();
    }, next);
});

/* ========================================================================== *
 * DOMAINS API                                                                *
 * ========================================================================== */

/* Create a new domain */
router.post('/', function (req, res, next) {
  // Validate and normalize parameters...
  var domain = req.body || {};
  if (!domain.name) return next(400);
  if (!domain.description) domain.description = domain.name;

  // Attempt to find an existing domain
  domains.find({name: domain.name}).then(function(existing) {
    if (existing[0]) return next(409);
    domains.create(domain).then(function(domain) {
      res.status(201).json(domain);
    }, next);
  }, next);
});

router.get('/', function (req, res, next) {
  domains.find().then(function(domains) {
    res.status(200).json(domains);
  }, next);
});

router.get('/:domain_uuid', function (req, res) {
  res.status(200).json(req.domain);
})

/* Our exports */
exports = module.exports = router;

