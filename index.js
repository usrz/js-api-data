var express = require('express');
var DbClient = require('./src/db-client.js');
var KeyManager = require('./src/key-manager.js');

var client = new DbClient('postgres://127.0.0.1/usrz')
var keyManager = new KeyManager(new Buffer(32).fill(0), client);

var domains = require('./src/api-domains.js')(keyManager, client);

var app = express();
app.use('/domains', domains);

listener = app.listen(8080, '127.0.0.1', function(error) {
  if (error) done(error);
  var address = listener.address();
  console.log('Running at http://' + address.address + ':' + address.port + '/login');
});
