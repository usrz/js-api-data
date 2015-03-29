var logger = require("./src/utils/logger");
var util = require("util");

process.on('uncaughtException', function(exception) {
  logger.error('Uncaught exception: %s', exception.stack);
});

var parser = require('body-parser');
var express = require('express');
var morgan = require('morgan')
var app = express();

function error(request, response) {
  return function(err) {
    console.log("ERR", err);
    logger.warn("%j", err);
    response.status(500).end();
  }
}

var uuid = require('uuid');
app.use(function(req, res, next) {
  var id = req.get("X-USRZ-Request-UUID");
  if (! id) id = uuid.v4();
  req.uuid = id;
  next();
});

app.use(require('./src/utils/respond')());

morgan.token('uuid', function(req) {
  return req.uuid;
})

app.set('json spaces', 2);

app.use(morgan(':date[iso] [:remote-addr] ":method :url HTTP/:http-version" :status :res[content-length] :response-time (:uuid)'));
app.use(parser.urlencoded({extended: true}));
app.use(parser.json());

app.use('/domains', require('./src/index'));

/* Anything else is a 404 */
app.use(function(req, res, next) {
  return next(404);
});

/* Last one is an error */
app.use(require('./src/utils/error')());


var server = app.listen(3000, function () {

  var host = server.address().address
  var port = server.address().port

  console.log('Example app listening at http://%s:%s', host, port)

})
