'use strict';

function normalize(req, prefix, link) {
  link = (link || '').toString();
  if (link) {
    // Remove trailing slashes
    while (link.endsWith('/')) {
      link = link.substr(0, link.length - 1);
    }

    // Absolute or relative link?
    if (link.startsWith('/')) return prefix + link;
    return prefix + req.baseUrl + '/' + link;
  }

  // No link
  return prefix + req.baseUrl;
}


exports = module.exports = function respond(prefix) {

  // Normalize prefix
  prefix = (prefix || '').toString();
  while (prefix.endsWith('/')) {
    prefix = prefix.substr(0, prefix.length - 1);
  }

  // The handler for the application
  return function handler(req, res, next) {

    // Add a "lastModified" function
    res.lastModified = function lastModified(date) {
      if (!(date instanceof Date)) date = new Date(date);
      res.append('Last-Modified', date.toUTCString());
      return res;
    }

    // Replace the "links" function
    var _links = res.links;
    res.links = function links(links) {
      for (var rel in links) {
        links[rel] = normalize(req, prefix, links[rel]);
      }
      return _links.call(this, links);
    }

    // Replace the "location" function
    var _location = res.location;
    res.location = function location(location) {
      location = normalize(req, prefix, location);
      return _location.call(this, location);
    }

    // Replace the "json" function
    var _json = res.json;
    res.json = function json(object, baseUrl) {
      var baseUrl = normalize(req, prefix, baseUrl);

      // This applies to objecs only
      if (typeof(object) === 'object') {

        // Arrays, just put
        if (Array.isArray(object)) {
          for (var i = 0; i < object.length; i++) {
            var current = object[i];
            if (current.href) continue;
            if (current.uuid) current.href = baseUrl + "/" + current.uuid;
          }
        }

        // Simple object, check for updated and
        else {
          // Instrument a "Last-Modified" header
          if (object.updated_at) res.lastModified(object.updated_at);
          // Add resource links
          if (object.uuid && (! object.href)) {
            object.href = baseUrl + "/" + object.uuid;
          }
          // Add a Link header
          if (object.href) {
            _location.call(this, object.href);
            _links.call(this, { self: object.href });
          }
        }
      }

      // Invoke the original json function
      return _json.call(this, object);
    }

    // Request instrumented, next!
    next();
  }
}

