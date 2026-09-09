'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { analyze } = require('./studio-service');
function items(text, documents = []) {
  const position = text.indexOf('|');
  return analyze({ path: path.resolve('test-output/modern-language/main.ag'), text: text.replace('|', ''), position, documents }).items;
}
test('keywords, actor fields, parameters, locals and their definition offsets', () => {
  const source = 'state S { int count; } actor C owns S { entry step(int delta) emits next: C { int local = delta; | } }';
  const result = items(source);
  for (const name of ['actor', 'require', 'count', 'delta', 'next', 'local']) assert.ok(result.some(x => x.name === name), name);
  for (const name of ['count', 'delta', 'local']) {
    const item = result.find(x => x.name === name);
    assert.equal(source.slice(item.position, item.position + name.length), name);
  }
});
test('self completion is scoped and includes inherited fields', () => {
  const result = items('state B { int inherited; } state S expands B { int own; } actor C owns S { entry step() { self.| } }');
  for (const name of ['inherited', 'own', 'value', 'cov_id']) assert.ok(result.some(x => x.name === name), name);
  assert.ok(!result.some(x => x.name === 'actor'));
});
test('local variables respect block scope and declaration order', () => {
  const result = items('state S {} actor C owns S { entry step() { int visible = 1; if (true) { int hidden = 2; } | int later = 3; } entry other(int wrong) {} }');
  assert.ok(result.some(x => x.name === 'visible'));
  for (const name of ['hidden', 'later', 'wrong']) assert.ok(!result.some(x => x.name === name), name);
});
test('unsaved imports participate and import cycles terminate', () => {
  const file = path.resolve('test-output/modern-language/types.ag');
  const docs = [{ path: file, text: 'import "./main.ag"; /// Imported value\nstate Imported { int field; }' }];
  const result = items('import "./types.ag"; actor C owns Imported { entry step() { self.| } }', docs);
  assert.equal(result.find(x => x.name === 'field').path, file);
});
test('unfinished source and Unicode before declarations remain usable', () => {
  const source = '// Grüße 🌍\nstate S { int count; } actor C owns S { entry step(int delta) { |';
  const result = items(source);
  assert.equal(result.find(x => x.name === 'count').position, source.indexOf('count'));
  assert.ok(result.some(x => x.name === 'delta'));
});
