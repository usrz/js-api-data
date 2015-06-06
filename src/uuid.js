'use strict';

const process = require('process');
const crypto = require('crypto');
const util = require('util');
const os = require('os');

// "Any" UUID (not only RFC-4122) accepting any variant
var expr = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var emac = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

/* ========================================================================== */
/* UUID CLASS                                                                 */
/* ========================================================================== */

//const BUFFER = new Symbol('buffer');

function UUID(data) {
  // Called as a function
  if (! (this instanceof UUID)) {
    if (data instanceof UUID) return data;
    return new UUID(data);
  }

  // Constructor
  var buffer;

  if (util.isBuffer(data)) {
    if (data.length !== 16) throw new TypeError('Buffer must contain precisely 128 bits');
    buffer = new Buffer(data);
  } else if (util.isString(data)) {
    if (! expr.test(data)) throw new TypeError('Incorrectly formatted UUID string');
    buffer = new Buffer(data.replace(/-/g, ''), 'hex');
  } else if (data instanceof UUID) {
    buffer = data._buffer;
  } else if (data) {
    throw new TypeError('Unable to construct UUID from ' + typeof(data));
  } else {
    throw new TypeError('No data for UUID');
  }

  var variant = null, version = null;
  if ((buffer[8] & 0x80) === 0) variant = 'NCS-RESERVED';
  else if ((buffer[8] & 0xE0) === 0xC0) variant = 'MICROSOFT-RESERVED';
  else if ((buffer[8] & 0xE0) === 0xE0) variant = 'RESERVED';
  else { // high bits of buffer[8] are 10xxxxxx (0x80)
    variant = 'RFC-4122';
    version = buffer[6] >> 4;
  }

  // Immutable properties
  Object.defineProperties(this, {
    '_buffer': {
      enumerable:   false,
      configurable: false,
      get:          function() {
        return new Buffer(buffer);
      }
    },
    'variant': { enumerable: true, configurable: false, value: variant },
    'version': { enumerable: true, configurable: false, value: version }
  });
}

/* ========================================================================== */

UUID.prototype.coerceRFC = function coerceRFC(version) {
  if (version == null) {
    if (this.variant === 'RFC-4122') return this;
  } else if (! util.isNumber(version)) {
    throw new TypeError('Version for UUID must be a number');
  } else if ((version < 0) || (version > 15) || (Math.round(version) !== version)) {
    throw new TypeError('Version for UUID must be non-negative integer less than 16');
  }

  // If this is already a RFC UUID, and version should not change return this
  if ((this.variant === 'RFC-4122') && ((version == null) || (version === this.version))) {
    return this;
  }

  // We need to mangle either variant, or version, or both...
  var buffer = this._buffer;

  // Variant coercion
  buffer[8] = (buffer[8] & 0x3F) | 0x80;

  // Version coercion
  if (version != null) {
    buffer[6] = (buffer[6] & 0x0F) | (version << 4);
  }

  // New UUID
  return new UUID(buffer);
};

/* ========================================================================== */

UUID.prototype.and = function and(uuid) {
  var buffer1 = this._buffer;
  var buffer2 = UUID.toUUID(uuid)._buffer;
  for (var i = 0; i < 16; i ++) buffer1[i] &= buffer2[i];
  return new UUID(buffer1);
};

UUID.prototype.or = function or(uuid) {
  var buffer1 = this._buffer;
  var buffer2 = UUID.toUUID(uuid)._buffer;
  for (var i = 0; i < 16; i ++) buffer1[i] |= buffer2[i];
  return new UUID(buffer1);
};

UUID.prototype.not = function not() {
  var buffer = this._buffer;
  for (var i = 0; i < 16; i ++) buffer[i] = ~ buffer[i];
  return new UUID(buffer);
};

UUID.prototype.xor = function xor(uuid) {
  var buffer1 = this._buffer;
  var buffer2 = UUID.toUUID(uuid)._buffer;
  for (var i = 0; i < 16; i ++) buffer1[i] ^= buffer2[i];
  return new UUID(buffer1);
};

/* ========================================================================== */

UUID.prototype.toString = function toString() {
  return this._buffer.slice( 0, 4).toString('hex') + '-'
       + this._buffer.slice( 4, 6).toString('hex') + '-'
       + this._buffer.slice( 6, 8).toString('hex') + '-'
       + this._buffer.slice( 8, 10).toString('hex') + '-'
       + this._buffer.slice(10, 16).toString('hex');
};

UUID.prototype.toJSON = function toJSON() {
  return this.toString();
};

/* ========================================================================== */
/* UTILITIES FOR STATIC METHODS                                               */
/* ========================================================================== */

/* Nanoseconds & clock sequence for V1 */
var nanoTimee = process.hrtime();
var clockSeq = (process.pid * nanoTimee[1]) & 0x0ffff;

function uuidbuffer(mac) {

  // If the MAC is unspecified, determine it
  if (mac == null) {
    var interfaces = os.networkInterfaces();
    for (var i in interfaces) {
      for (var a in interfaces[i]) {
        var current = interfaces[i][a].mac;
        if (current && (current !== '00:00:00:00:00:00')) {
          mac = current;
          break;
        }
      }
    }
  }

  // Check that we actually do have a MAC
  if (mac == null) throw new Error('Unable to determine MAC address');
  if (! util.isString(mac)) throw new TypeError('MAC address must be a string');
  if (! emac.test(mac)) throw new TypeError('Invalid MAC address ' + mac);

  // Allocate the buffer
  var buffer = new Buffer(16).fill(0);

  // Get the gregorian time in millis and nanosconds
  var time = new Date().getTime();
  var greg = time + 12219292800000;
  var nano = process.hrtime(nanoTimee)[1] % 10000;

  // Lower and higher (high + mid) 32-bit values
  var low = ((greg & 0xfffffff) * 10000 + nano) % 0x100000000;
  var tim = (greg / 0x100000000 * 10000) & 0xfffffff;
  var hig = (tim >> 16) & 0xFFFF;
  var mid = tim & 0xFFFF;

  // Write numbers in buffer
  buffer.writeUInt32BE(low, 0);
  buffer.writeUInt16BE(mid, 4);
  buffer.writeUInt16BE(hig, 6);
  buffer.writeUInt16BE(clockSeq, 8);

  // Insert the MAC address
  var index = 10;
  mac.split(':').forEach(function (number) {
    buffer[index ++] = parseInt(number, 16);
  });

  // Return our buffer as is...
  return buffer;
}

/* ========================================================================== */
/* STATIC METHODS                                                             */
/* ========================================================================== */

UUID.v1uuid = function v1uuid(mac) {
  var buffer = uuidbuffer(mac);

  // Version and variant
  buffer[6] = (buffer[6] & 0x0F) | 0x10;
  buffer[8] = (buffer[8] & 0x3F) | 0x80;

  // Return a new UUID
  return new UUID(buffer);
};

UUID.v2uuid = function v2uuid(id, type, mac) {
  var args = Array.prototype.slice.call(arguments);

  if (args.length === 0) {
    id = process.getuid();
    type = 0; // person
    mac = null;
  } else if (args.length === 1) {
    if (util.isBoolean(args[0])) {
      if (args[0]) {
        id = process.getgid();
        type = 1; // domain
      } else {
        id = process.getuid();
        type = 0; //
      }
    } else if (util.isString(args[0])) {
      mac = args[0];
      id = process.getuid();
      type = 0;
    } else if (util.isNumber(args[0])) {
      type = 0; // default to person
      mac = null; // determine mac
    }
  }

  if (util.isBoolean(type)) type = type ? 1 : 0;
  if (! util.isNumber(id)) throw new Error('UID/GID is not a number');
  if (! util.isNumber(type)) throw new Error('UUIDv2 type is not a number');

  var buffer = uuidbuffer(mac);

  // ID replaces high time
  buffer.writeUInt32BE(id, 0);
  buffer[9] = type;

  // Version and variant
  buffer[6] = (buffer[6] & 0x0F) | 0x20;
  buffer[8] = (buffer[8] & 0x3F) | 0x80;

  // Return the UUID
  return new UUID(buffer);
};


UUID.v3uuid = function v3uuid(namespace, name) {
  if (arguments.length < 2) throw new TypeError('Namespace and name required');

  namespace = UUID.toUUID(namespace);
  if (util.isString(name)) {
    name = new Buffer(name, 'utf8');
  } else if (! util.isBuffer(name)) {
    throw new TypeError('Name must be a string or Buffer');
  }

  var buffer = crypto.createHash('MD5')
                     .update(namespace._buffer)
                     .update(name)
                     .digest();

  buffer[6] = (buffer[6] & 0x0F) | 0x30;
  buffer[8] = (buffer[8] & 0x3F) | 0x80;

  return new UUID(buffer);
};

UUID.v4uuid = function v4uuid() {

  // Get randon data and generate UUID
  var buffer = crypto.randomBytes(16);
  buffer[6] = (buffer[6] & 0x0F) | 0x40;
  buffer[8] = (buffer[8] & 0x3F) | 0x80;
  return new UUID(buffer);

};

UUID.v5uuid = function v5uuid(namespace, name) {
  if (arguments.length < 2) throw new TypeError('Namespace and name required');

  namespace = UUID.toUUID(namespace);
  if (util.isString(name)) {
    name = new Buffer(name, 'utf8');
  } else if (! util.isBuffer(name)) {
    throw new TypeError('Name must be a string or Buffer');
  }

  var buffer = crypto.createHash('SHA1')
                     .update(namespace._buffer)
                     .update(name)
                     .digest();

  buffer[6] = (buffer[6] & 0x0F) | 0x50;
  buffer[8] = (buffer[8] & 0x3F) | 0x80;

  return new UUID(buffer.slice(0, 16));
};

/* ========================================================================== */

UUID.v1 = function v1() {
  return UUID.v1uuid.apply(null, arguments).toString();
};

UUID.v2 = function v2() {
  return UUID.v2uuid.apply(null, arguments).toString();
};

UUID.v3 = function v3() {
  return UUID.v3uuid.apply(null, arguments).toString();
};

UUID.v4 = function v4() {
  return UUID.v4uuid.apply(null, arguments).toString();
};

UUID.v5 = function v5() {
  return UUID.v5uuid.apply(null, arguments).toString();
};

/* ========================================================================== */

UUID.toUUID = function(uuid) {
  if (uuid instanceof UUID) return uuid;
  return new UUID(uuid);
};

UUID.validateuuid = function validate(uuid) {
  try {
    return UUID.toUUID(uuid);
  } catch (error) {
    return null;
  }
};

UUID.validate = function validate(uuid) {
  uuid = UUID.validateuuid(uuid);
  return uuid ? uuid.toString() : null;
};

/* ========================================================================== *
 * CONSTANT/KNOWN UUIDs                                                       *
 * ========================================================================== */

UUID.NS_DNS = new UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
UUID.NS_URL = new UUID('6ba7b811-9dad-11d1-80b4-00c04fd430c8');
UUID.NS_OID = new UUID('6ba7b812-9dad-11d1-80b4-00c04fd430c8');
UUID.NS_X500 = new UUID('6ba7b814-9dad-11d1-80b4-00c04fd430c8');
UUID.NULL = new UUID('00000000-0000-0000-0000-000000000000');

UUID.EXPR = expr;

/* ========================================================================== *
 * MODULE EXPORTS                                                             *
 * ========================================================================== */

exports = module.exports = UUID;
