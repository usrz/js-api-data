var util = require("util");

var parser = require('body-parser');
var express = require('express');
var morgan = require('morgan')
var app = express();

// var uuid = require('uuid');
// app.use(function(req, res, next) {
//   var id = req.get("X-USRZ-Request-ID");
//   if (! id) id = uuid.v4();
//   req.id = id;
//   next();
// });

app.use(require('./src/utils/respond')());

// morgan.token('uuid', function(req) {
//   return req.uuid;
// })

app.set('json spaces', 2);

//app.use(morgan(':date[iso] [:remote-addr] ":method :url HTTP/:http-version" :status :res[content-length] :response-time (:uuid)'));
//app.use(parser.urlencoded({extended: true}));
//app.use(parser.json());

var S = require('./src/express/statuses');

//app.use('/domains', require('./src/index'));
//console.log(S);

app.get('/1', function(req, res, next) {
  next(S.NOT_FOUND);
});

app.get('/2', function(req, res, next) {
  next(S.NOT_FOUND("The file you mentioned was not found"));
});

app.get('/3', function(req, res, next) {
  next(S.NOT_FOUND({details: "Some details"}));
});

app.get('/4', function(req, res, next) {
  next(S.NOT_FOUND("override message", {details: "Some more details"}));
});

app.get('/5', function(req, res, next) {
  next(404);
});

app.get('/6', function(req, res, next) {
  next("A simple error...");
});

app.get('/7', function(req, res, next) {
  var e = new Error("This shall be thrown");
  e.details = { 'some' : 'error details' };
  throw e;
});


// Error logging
var errorlog = require('errorlog')();
app.use(require('express-errorlog')());

process.on('uncaughtException', function(exception) {
  errorlog('Uncaught exception', exception);
});

var server = app.listen(3000, function () {
  var host = server.address().address
  var port = server.address().port
  errorlog('Example app listening at http://%s:%s', host, port)

})
