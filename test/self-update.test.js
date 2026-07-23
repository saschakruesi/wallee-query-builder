const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders } = require('./harness');

let X;
test.before(() => { X = loadBuilders(); });

test('istNeuer erkennt neuere Versionen', () => {
  assert.ok(X.istNeuer('5.5.0', '5.6.0'));
  assert.ok(X.istNeuer('5.5.0', 'v5.5.1'));
  assert.ok(X.istNeuer('5.5.0', '6.0.0'));
  assert.ok(!X.istNeuer('5.5.0', '5.5.0'));
  assert.ok(!X.istNeuer('5.5.0', '5.4.9'));
  assert.ok(!X.istNeuer('5.5.0', '5.4.99'));
  assert.ok(!X.istNeuer('5.5.0', 'main'), 'Formatfehler -> kein Update');
  assert.ok(!X.istNeuer('quatsch', '5.6.0'));
});
