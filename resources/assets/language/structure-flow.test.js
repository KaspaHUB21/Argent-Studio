'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { structure } = require('./structure-service');
const model = text => structure({ path: path.resolve('test-output/flow.ag'), text });

test('ticket flow connects actual input values through constructed state to declared successors', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../../examples/catalog/tickets/tickets.ag'), 'utf8');
  const result = model(text), { nodes, edges } = result.flow;
  const action = nodes.find(n => n.kind === 'entry' && n.name === 'issue');
  const inputs = nodes.filter(n => n.parent === action.id && n.role === 'input');
  assert.ok(inputs.some(n => n.name === 'admin' && n.valueType === 'byte[32]'));
  assert.ok(inputs.some(n => n.name === 'owner_pk' && n.valueType === 'pubkey'));
  const owner = nodes.find(n => n.parent === action.id && n.valueName === 'owner');
  const ownerInput = inputs.find(n => n.name === 'owner_pk');
  assert.ok(edges.some(e => e.from === ownerInput.id && e.to === owner.id && e.kind === 'value'));
  const output = nodes.find(n => n.parent === action.id && n.name === 'ticket' && n.role === 'output');
  const transition = nodes.find(n => n.parent === action.id && n.kind === 'transition');
  const part = nodes.find(n => n.parent === transition.id && n.text.startsWith('ticket <-'));
  assert.ok(edges.some(e => e.from === part.id && e.to === output.id && e.kind === 'value'));
  assert.ok(nodes.some(n => n.parent === action.id && n.name === 'ticket.value' && n.role === 'input' && !n.editable));
  assert.equal(result.flow.warning, '');
  for (const n of nodes.filter(n => n.editable)) {
    assert.equal(n.text, text.slice(n.start, n.end));
    assert.ok(result.nodes.some(c => c.id === n.definitionId), 'Editable alias resolves to canonical source');
  }
});

test('local reassignment changes the provider used by following checks', () => {
  const result = model('state S { int count; } actor A owns S { entry step(int amount) { int x = amount; x = x + 1; require(x == 2); } }');
  const { nodes, edges } = result.flow;
  const first = nodes.find(n => n.text === 'int x = amount;');
  const second = nodes.find(n => n.text === 'x = x + 1;');
  const check = nodes.find(n => n.kind === 'check');
  assert.ok(edges.some(e => e.from === first.id && e.to === second.id && e.kind === 'value'));
  assert.ok(edges.some(e => e.from === second.id && e.to === check.id && e.kind === 'value'));
  assert.ok(!edges.some(e => e.from === first.id && e.to === check.id && e.kind === 'value'));
});

test('if else-if branches expand without serializing alternative bodies', () => {
  const result = model('state S { int count; } actor A owns S { entry step(int amount) { if (amount > 0) { require(count > 0); } else if (amount < 0) { require(count < 0); } else { require(count == 0); } require(amount != 9); } }');
  const { nodes, edges } = result.flow;
  const branches = nodes.filter(n => n.kind === 'branch');
  assert.equal(branches.length, 2);
  const positive = nodes.find(n => n.text === 'require(count > 0);');
  const negative = nodes.find(n => n.text === 'require(count < 0);');
  assert.ok(!edges.some(e => e.from === positive.id && e.to === negative.id && e.kind === 'control'));
  const after = nodes.find(n => n.text === 'require(amount != 9);');
  assert.ok(edges.some(e => e.from === branches[0].id && e.to === after.id && e.kind === 'control'));
  assert.ok(edges.some(e => e.kind === 'control' && e.labelEn === 'otherwise'));
});

test('field writes are not local declarations and incomplete semantics are disclosed', () => {
  const result = model('state S { int count; } actor A owns S { entry step(S value) { value.count = mystery(count); require(value.count > 0); } }');
  const assignment = result.flow.nodes.find(n => n.text === 'value.count = mystery(count);');
  assert.notEqual(assignment.valueName, 'count');
  assert.ok(result.flow.warningEn.includes('Unknown calls remain opaque: mystery'));
  assert.ok(result.flow.warningEn.includes('Complex assignments'));
});

test('record composition has value edges from individual fields to the constructed value', () => {
  const result = model('state S { int count; } actor A owns S { entry step() emits next: A { S updated = { count: count + 1, }; become next <- A(updated); } }');
  const { nodes, edges } = result.flow;
  const record = nodes.find(n => n.valueName === 'updated');
  const member = nodes.find(n => n.parent === record.id);
  assert.ok(edges.some(e => e.from === member.id && e.to === record.id && e.kind === 'value'));
  const transition = nodes.find(n => n.kind === 'transition');
  assert.ok(edges.some(e => e.from === record.id && e.to === transition.id && e.kind === 'value'));
});

test('branch-local declarations do not replace an outer value after the branch', () => {
  const result = model('state S { int count; } actor A owns S { entry step(int x) { if (x > 0) { int x = 9; require(x == 9); } require(x != 8); } }');
  const { nodes, edges } = result.flow;
  const input = nodes.find(n => n.kind === 'parameter' && n.name === 'x');
  const last = nodes.find(n => n.text === 'require(x != 8);');
  assert.ok(edges.some(e => e.from === input.id && e.to === last.id && e.kind === 'value'));
  assert.ok(!edges.some(e => nodes.find(n => n.id === e.from)?.kind === 'branch' && e.to === last.id && e.kind === 'value'));
});

test('navigation starts at app and sorts independent actions while checks retain source order', () => {
  const result = model('state S { int count; } actor A owns S { entry z() { require(count > 9); require(count < 2); } entry a() { require(count == 0); } } app Demo { actor A; }');
  const { nodes } = result.flow;
  assert.equal(nodes[0].kind, 'app');
  assert.deepEqual(nodes.filter(n => n.kind === 'entry').map(n => n.name), ['a', 'z']);
  const z = nodes.find(n => n.kind === 'entry' && n.name === 'z');
  assert.deepEqual(nodes.filter(n => n.parent === z.id && n.kind === 'check').map(n => n.text), ['require(count > 9);', 'require(count < 2);']);
  const canonical = result.nodes.find(n => n.kind === 'field');
  assert.equal(nodes.filter(n => n.definitionId === canonical.id).length, 3);
});

test('conditional outer assignments merge assigned and unchanged values at the branch', () => {
  const result = model('state S { int count; } actor A owns S { entry step(int x) { if (count > 0) { x = x + 1; } require(x > 0); } }');
  const { nodes, edges } = result.flow;
  const input = nodes.find(n => n.kind === 'parameter' && n.name === 'x');
  const branch = nodes.find(n => n.kind === 'branch');
  const assignment = nodes.find(n => n.text === 'x = x + 1;');
  const last = nodes.find(n => n.text === 'require(x > 0);');
  assert.ok(edges.some(e => e.from === assignment.id && e.to === branch.id && e.kind === 'value'));
  assert.ok(edges.some(e => e.from === input.id && e.to === branch.id && e.kind === 'value'));
  assert.ok(edges.some(e => e.from === branch.id && e.to === last.id && e.kind === 'value'));
  assert.ok(!edges.some(e => e.from === input.id && e.to === last.id && e.kind === 'value'));
});

test('both assignment alternatives feed a merged value, not each other', () => {
  const result = model('state S { int count; } actor A owns S { entry step(int x) { if (count > 0) { x = 1; } else { x = 2; } require(x > 0); } }');
  const { nodes, edges } = result.flow;
  const branch = nodes.find(n => n.kind === 'branch');
  const a = nodes.find(n => n.text === 'x = 1;'), b = nodes.find(n => n.text === 'x = 2;');
  const last = nodes.find(n => n.text === 'require(x > 0);');
  for (const assignment of [a, b]) assert.ok(edges.some(e => e.from === assignment.id && e.to === branch.id && e.kind === 'value'));
  assert.ok(edges.some(e => e.from === branch.id && e.to === last.id && e.kind === 'value'));
  assert.ok(!edges.some(e => e.from === a.id && e.to === b.id));
});

test('flow replaces the obsolete tree projection and reports unfinished syntax bilingually', () => {
  const result = model('state S { int count; } actor A owns S { entry step() { require(count > 0);');
  assert.equal(result.presentation, undefined);
  assert.ok(result.warning.includes('Unvollständige Klammerstruktur'));
  assert.ok(result.warningEn.includes('Incomplete delimiter structure'));
  assert.ok(result.flow.nodes.some(n => n.kind === 'check'));
});

test('nested record literals expose their actual members recursively with exact source spans', () => {
  const result = model('state Inner { int count; } state Outer { Inner inner; } actor A owns Outer { entry step(int amount) { Outer updated = { inner: { count: amount, }, }; } }');
  const { nodes, edges } = result.flow;
  const record = nodes.find(n => n.valueName === 'updated');
  const inner = nodes.find(n => n.parent === record.id && n.text.startsWith('inner:'));
  const count = nodes.find(n => n.parent === inner.id && n.text === 'count: amount');
  assert.ok(count);
  assert.ok(edges.some(e => e.from === count.id && e.to === inner.id && e.valueName === 'updated.inner.count'));
  assert.ok(edges.some(e => e.to === count.id && e.valueName === 'amount'));
});

test('branch control joins connect continuing paths without joining terminating transitions', () => {
  const result = model('state S { int count; } actor A owns S { entry step() emits next: A { if (count > 0) { require(count < 9); } else { become next <- A(S { count: 0 }); } require(count != 5); } }');
  const { nodes, edges } = result.flow;
  const branch = nodes.find(n => n.kind === 'branch');
  const check = nodes.find(n => n.text === 'require(count < 9);');
  const transition = nodes.find(n => n.kind === 'transition');
  const after = nodes.find(n => n.text === 'require(count != 5);');
  assert.ok(edges.some(e => e.from === check.id && e.to === branch.id && e.kind === 'control'));
  assert.ok(!edges.some(e => e.from === transition.id && e.to === branch.id && e.kind === 'control'));
  assert.ok(edges.some(e => e.from === branch.id && e.to === after.id && e.kind === 'control'));
});
