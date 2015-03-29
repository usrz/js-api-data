var util = require('util');

/* Initalize postgrs */
var pg = require('pg');
try {
  pg = pg.native;
} catch (error) {
  console.warn('Native Postgres driver unavailable');
}

/* Postgres formatter */
var format = require('pg-format');

function order(orderby) {
  if (typeof(orderby) === 'string') {
    return format.ident(orderby);
  } else if (Array.isArray(orderby)) {
    var components = [];
    for (var i = 0; i < orderby.length; i++) {
      components.push(order(orderby[i]));
    }
    return components.join(', ');
  } else if (orderby.asc) {
    return format.ident(orderby.asc) + " ASC";
  } else if (orderby.desc) {
    return format.ident(orderby.desc) + " DESC";
  } else {
    throw new Error(util.forma("Invalid ordering specification %j", orderby));
  }
}


function build(statement) {
  if (typeof(statement) !== 'object') return statement;

  var index = 1;
  if (statement.values) {
    index = statement.values.length + 1;
  } else {
    statement.values = [];
  }

  var where = [];
  if (statement.where) for (var identifier in statement.where) {
    var ident = format.ident(identifier);
    var value = statement.where[identifier];

    if (typeof(value) === 'object') {
      if (value.eq) {
        where.push(ident + ' = $' + (index ++));
        statement.values.push(value.eq);
      } else if (value.lt) {
        where.push(ident + ' < $' + (index ++));
        statement.values.push(value.lt);
      } else if (value.gt) {
        where.push(ident + ' > $' + (index ++));
        statement.values.push(value.gt);
      } else if (value.like) {
        where.push(ident + ' LIKE $' + (index ++));
        statement.values.push(value.like);
      } else if (value.in) {
        var placeholders = [];
        if (Array.isArray(value.in)) {
          for (var i in value.in) {
            placeholders.push('$' + (index++));
            statement.values.push(value.in[i]);
          }
        } else {
          placeholders.push('$' + (index++));
          statement.values.push(value.in);
        }

        where.push(ident + ' IN (' + placeholders.join(', ') + ')');

      } else {
        throw new Error(util.format('Unrecognized where clause %j', value));
      }
    } else {
      where.push(ident + ' = $' + (index ++));
      statement.values.push(value);
    }
  }

  /* Mangle the query */
  if (where.length > 0) {
    delete statement.name;

    /* Is this a "WHERE" or an "AND" ??? */
    if (/where/i.test(statement.text)) {
      statement.text += ' AND ' + where.join(' AND ');
    } else {
      statement.text += ' WHERE ' + where.join(' AND ');
    }
  }

  /* Add ordering */
  if (statement.order) {
    var ordering = order(statement.order);
    if (ordering) {
      delete statement.name;
      statement.text += ' ORDER BY ' + ordering;
    }
  }

  /* Add offset */
  if (statement.offset) {
    if (Number.parseInt(statement.offset) > 0) {
      delete statement.name;
      statement.text += " OFFSET $" + (index ++);
      statement.values.push(statement.offset);
    }
  }

  /* Add limit */
  if (statement.limit) {
    if (Number.parseInt(statement.limit) > 0) {
      delete statement.name;
      statement.text += " LIMIT $" + (index ++);
      statement.values.push(statement.limit);
    }
  }

  /* Clean and return our statement */
  delete statement.where;
  delete statement.order;
  delete statement.offset;
  delete statement.limit;
  return statement;
}


/* Simple query */
function query(uri, statement, callback) {

  // Normalize callback/onlyone
  var onlyone = false;
  if (typeof(callback) === 'boolean') {
    onlyone = callback;
    callback = null;
  }

  // Always returns a promise
  return new Promise(function(success, failure) {

    // Connect with the URI we were given
    pg.connect(uri, function(error, client, done) {

      // Unable to get a client ???
      if (error) return failure(error);

      // Build the statement and catch
      try {
        statement = build(statement);
      } catch (error) {
        return failure(error);
      }

      // Run the query
      client.query(statement, function(error, result) {
        done();

        // Exception in the query
        if (error) return failure(error);

        // If we have a callback, invoke it
        if (callback) try {
          return success(callback(result));
        } catch (exception) {
          return failure(exception);
        }

        // Return all rows or only one?
        return success(onlyone ? result.rows[0] : result.rows);
      });
    });
  });
}

/* Also export our "pg" */
exports = module.exports = query;
exports.build = build;
exports.pg = pg;
