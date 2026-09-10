'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { structure } = require('./structure-service');
test('record writes are distinct from field reads in every projected alias', () => {
  const result = structure({ path: path.resolve('test-output/read-write.ag'), text: 'state S { int value; } actor C owns S { entry step() emits next: C { require(value == 0); S updated = { value: value + 1, }; become next <- C(updated); } } app A { actor C; }' });
  const check = result.nodes.find(n => n.kind === 'check');
  const assign = result.nodes.find(n => n.kind === 'statement');
  const field = result.nodes.find(n => n.kind === 'field');
  assert.ok(result.edges.some(e => e.from === check.id && e.to === field.id && e.label === 'liest Feld'));
  assert.ok(!result.edges.some(e => e.from === check.id && e.label === 'setzt Feld'));
  for (const label of ['liest Feld', 'setzt Feld']) {
    assert.ok(result.edges.some(e => e.from === assign.id && e.to === field.id && e.label === label));
    assert.ok(result.presentation.edges.some(e => e.label === label));
  }
});
function model(text, documents = []) { return structure({ path: path.resolve('test-output/structure/main.ag'), text, documents }); }
test('tickets have exact editable source ranges and the intended relationships', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../examples/catalog/tickets/tickets.ag'), 'utf8');
  const result = model(text);
  const view = result.presentation;
  const issuerView = view.nodes.find(n => n.kind === 'actor' && n.name === 'Issuer');
  const stateView = view.nodes.find(n => n.kind === 'state' && n.name === 'IssuerState');
  assert.equal(stateView.parent, issuerView.id);
  assert.ok(!view.nodes.some(n => n.kind === 'group' && n.name === 'Gespeicherter Zustand'));
  assert.deepEqual(view.edges.filter(e => e.from === issuerView.id && e.to === stateView.id).map(e => e.label), ['verwendet Zustand']);
  for (const n of result.nodes) assert.equal(n.text, text.slice(n.start, n.end), n.name);
  const find = (kind, name) => result.nodes.find(n => n.kind === kind && n.name === name);
  const issuer = find('actor', 'Issuer'), ticket = find('actor', 'Ticket'), state = find('state', 'IssuerState');
  assert.ok(issuer.text.startsWith('actor Issuer owns IssuerState {'));
  assert.ok(issuer.text.endsWith('}'));
  assert.ok(result.edges.some(e => e.from === issuer.id && e.to === state.id && e.label === 'verwendet Zustand'));
  assert.ok(result.edges.some(e => e.from === find('entry', 'issue').id && e.to === ticket.id && e.label === 'erzeugt'));
  const admin = find('field', 'admin');
  assert.equal(admin.text, 'byte[32] admin;');
  assert.ok(result.edges.some(e => e.to === admin.id && e.label === 'liest Feld'));
  assert.ok(result.nodes.some(n => n.kind === 'parameter' && n.text === 'sig admin_sig'));
  assert.ok(result.nodes.some(n => n.kind === 'transition' && n.text.startsWith('become {') && n.text.endsWith('};')));
});
test('comments and strings do not create references, Unicode ranges remain exact', () => {
  const text = '// Grüße 🌍\nstate S { int count; int ignored; } actor C owns S { entry step() { // ignored\n require(count == 1); } } app A { actor C; }';
  const result = model(text); const count = result.nodes.find(n => n.kind === 'field' && n.name === 'count');
  const ignored = result.nodes.find(n => n.kind === 'field' && n.name === 'ignored');
  assert.equal(count.text, 'int count;');
  assert.ok(result.edges.some(e => e.to === count.id && e.label === 'liest Feld'));
  assert.ok(!result.edges.some(e => e.to === ignored.id && e.label === 'liest Feld'));
});
test('imported states use unsaved source and cycles are finite', () => {
  const file = path.resolve('test-output/structure/state.ag');
  const result = model('import "./state.ag"; actor C owns S { entry step() { require(count == 2); } }', [{ path: file, text: 'import "./main.ag"; state S { int count; }' }]);
  const state = result.nodes.find(n => n.kind === 'state');
  assert.equal(state.path, file);
  assert.equal(result.nodes.filter(n => n.kind === 'file').length, 2);
  assert.ok(result.edges.some(e => e.to === state.id && e.label === 'verwendet Zustand'));
});
test('field shadowing resolves later reads to the local variable', () => {
  const result = model('state S { int count; } actor C owns S { entry step() { int count = 5; require(count == 5); } }');
  const local = result.nodes.find(n => n.kind === 'local');
  const check = result.nodes.find(n => n.kind === 'check');
  assert.ok(result.edges.some(e => e.from === check.id && e.to === local.id));
  assert.ok(!result.edges.some(e => e.from === check.id && e.label === 'liest Feld'));
});
test('unfinished actor body remains represented for editing', () => {
  const result = model('state S { int count; } actor C owns S { entry step(int amount) { require(count < amount);');
  assert.ok(result.nodes.some(n => n.kind === 'entry'));
  assert.ok(result.nodes.some(n => n.kind === 'check'));
  assert.ok(result.nodes.every(n => n.end >= n.start));
});
test('semantic tree order and identities survive moving all top-level declarations', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../examples/catalog/tickets/tickets.ag'), 'utf8');
  const first = model(text);
  const declarations = first.nodes.filter(n => ['app', 'actor', 'state'].includes(n.kind));
  const second = model(declarations.reverse().map(n => n.text).join('\n\n'));
  const shape = m => m.presentation.nodes.map(n => [n.id, n.parent, n.kind, n.name]);
  assert.deepEqual(shape(first), shape(second));
  assert.equal(first.presentation.nodes[0].kind, 'app');
  assert.ok(!first.presentation.nodes.some(n => n.kind === 'file'));
});
test('one field appears under several actions with the same source identity and exact range', () => {
  const result = model('state S { int count; } actor C owns S { entry b() { require(count == 2); } entry a() { require(count == 1); } } app A { actor C; }');
  const source = result.nodes.find(n => n.kind === 'field');
  const aliases = result.presentation.nodes.filter(n => n.definitionId === source.id);
  assert.equal(aliases.length, 3); // two actions and stored state
  assert.equal(new Set(aliases.map(n => n.id)).size, 3);
  assert.ok(aliases.every(n => n.text === 'int count;' && n.start === source.start));
  assert.deepEqual(result.presentation.nodes.filter(n => n.kind === 'entry').map(n => n.name), ['a', 'b']);
});
test('field references distinguish record labels, local shadowing, parameters and unrelated states', () => {
  const text = 'state S { int count; } state T { int count; } actor C owns S { entry a(int amount) { require(count == amount); S next = { count: count + 1, }; { int count = 4; require(count == 4); } require(count > 0); } entry b(int count) { require(count > 1); } } app A { actor C; }';
  const result = model(text), fields = result.nodes.filter(n => n.kind === 'field');
  assert.equal(fields[0].references.length, 5); // definition, require, label, value, after nested scope
  assert.equal(fields[1].references.length, 1);
  assert.ok(fields[0].references.every(r => text.slice(r.start, r.end) === 'count'));
  assert.ok(fields[0].renameSafe);
});
test('unresolved member names prevent automatic rename', () => {
  const result = model('state S { int count; } actor C owns S { entry a() { require(unknown.count == count); } }');
  assert.equal(result.nodes.find(n => n.kind === 'field').renameSafe, false);
});
test('analysis warnings include English without translating file names', () => {
  const result = model('import "./fehlend-example.ag"; state S { int count; }');
  assert.equal(result.warning, 'Import nicht lesbar: fehlend-example.ag');
  assert.equal(result.warningEn, 'Cannot read import: fehlend-example.ag');
  const large = model(' '.repeat(2000001));
  assert.equal(large.warningEn, 'Project size limit reached');
});
