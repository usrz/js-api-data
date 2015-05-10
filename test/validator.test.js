'use strict';

const expect = require('chai').expect;
const Validator = require('../src/validator');

describe('Validator', function() {

  it('should validate a type', function() {
    var object = {field: 'a string'};
    var constr = {field: {type: 'string'}};
    var validator = new Validator(constr);

    expect(validator.validate({})).to.eql({});
    expect(validator.validate(object)).to.eql(object);

    try {
      validator.validate({field: 123});
      throw new Error('Should not validate');
    } catch (error) {
      expect(error.message).to.equal('Object failed to validate');
      expect(error.validation).to.eql({ field: [ 'Field must be a string' ] });
      expect(error.object).to.eql({field: 123});
    }
  })

  it('should validate a domain', function() {
    var object = {field: 'foobar.com'};
    var constr = {field: { domain: true}};
    var validator = new Validator(constr);

    expect(validator.validate({})).to.eql({});
    expect(validator.validate(object)).to.eql(object);

    try {
      validator.validate({field: 'phony'});
      throw new Error('Should not validate');
    } catch (error) {
      expect(error.message).to.equal('Object failed to validate');
      expect(error.validation).to.eql({ field: [ 'Field is not a valid domain name' ] });
      expect(error.object).to.eql({field: 'phony'});
    }
  })

  it('should normalize a string', function() {
    var object = {field: ' a   quick \n fox\tjumped   over   the   lazy   dog! \n '};
    var constr = {field: { normalize: true}};
    var validator = new Validator(constr);

    // No field
    expect(validator.validate({nah: true})).to.eql({nah: true});

    expect(validator.validate(object))
      .to.eql({field: 'a quick fox jumped over the lazy dog!'});
  });

  it('should normalize a deep string', function() {
    var object = {a:{b:{c:{d:{e:{f:' a   quick \n fox\tjumped   over   the   lazy   dog! \n '}}}}}};
    var constr = {"a.b.c.d.e.f": { normalize: true}};
    var validator = new Validator(constr);

    expect(validator.validate(object))
      .to.eql({a:{b:{c:{d:{e:{f:'a quick fox jumped over the lazy dog!'}}}}}});
  });



});
