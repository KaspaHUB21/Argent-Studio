import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const language = require('../resources/assets/language/argent-service.js');
const { analyze } = require('../resources/assets/language/studio-service.js');
const { structure } = require('../resources/assets/language/structure-service.js');
const root = path.resolve('test-output/toolchain-language');
const file = name => path.join(root, name);
function request(text, documents = []) {
  return { path: file('main.ag'), text: text.replace('|', ''), position: text.indexOf('|'), documents };
}
test('pinned scanner indexes module aliases, qualified state types and app actor paths', () => {
  const scan = language.scanDocument('import "types.ag" as lib; state Child expands lib::Base { lib::Payload payload; } actor C owns lib::Base {} app A { actor lib::Remote; actor C; }');
  assert.equal(scan.imports[0].alias, 'lib');
  assert.equal(scan.declarations.find(d => d.name === 'Child').baseState, 'lib::Base');
  assert.equal(scan.declarations.find(d => d.name === 'Child').fields[0].type, 'lib::Payload');
  assert.equal(scan.declarations.find(d => d.name === 'C').ownedState, 'lib::Base');
  assert.deepEqual(scan.declarations.find(d => d.name === 'A').actors, ['lib::Remote', 'C']);
});
test('module completion uses unsaved namespaced imports and excludes private unqualified names', () => {
  const documents = [{ path: file('types.ag'), text: 'state S { int imported; } actor C owns S {} app A { actor C; }' }];
  const imported = analyze(request('import "types.ag" as lib; actor Local owns lib::S { entry step() { self.| } }', documents));
  assert.equal(imported.items.find(x => x.name === 'imported').path, file('types.ag'));
  const global = analyze(request('import "types.ag" as lib; |', documents)).items;
  assert.ok(global.some(x => x.name === 'lib'));
  assert.ok(!global.some(x => x.name === 'S'));
  const members = analyze(request('import "types.ag" as lib; lib::|', documents)).items;
  assert.deepEqual(members.map(x => x.name), ['A', 'C', 'S']);
  assert.deepEqual(analyze(request('import "types.ag" as lib; lib::A::|', documents)).items.map(x => x.name), ['C']);
});
test('namespaced inherited fields resolve through cyclic imports and reject ambiguous names', () => {
  const documents = [
    { path: file('child.ag'), text: 'import "base.ag" as base; import "main.ag"; state Child expands base::Base { int own; }' },
    { path: file('base.ag'), text: 'state Base { int inherited; }' },
  ];
  const result = analyze(request('import "child.ag" as child; actor C owns child::Child { entry step() { self.| } }', documents));
  for (const field of ['own', 'inherited']) assert.ok(result.items.some(x => x.name === field));
  const ambiguous = analyze(request('import "base.ag"; import "other.ag"; actor C owns Base { entry step() { self.| } }', [...documents, { path: file('other.ag'), text: 'state Base { int unrelated; }' }]));
  assert.ok(!ambiguous.items.some(x => ['inherited', 'unrelated'].includes(x.name)));
});
test('structure preserves exact editable definitions for qualified actors and inherited states', () => {
  const documents = [{ path: file('types.ag'), text: 'state Base { int inherited; } actor C owns Base {} app Remote { actor C; }' }];
  const result = structure(request('import "types.ag" as lib; state Child expands lib::Base { int count; } actor Local owns Child { entry step() emits next: lib::Remote::C { require(self.inherited > 0); become next <- lib::Remote::C(state(self)); } } app A { actor Local; actor lib::Remote::C; }', documents));
  const node = name => result.nodes.find(n => n.name === name);
  assert.ok(result.edges.some(e => e.from === node('Child').id && e.to === node('Base').id && e.label === 'erweitert'));
  assert.ok(result.edges.some(e => e.from === node('A').id && e.to === node('C').id && e.label === 'enthält Actor'));
  assert.ok(result.edges.some(e => e.from === node('next').id && e.to === node('C').id && e.label === 'Actor-Typ'));
  assert.equal(node('Base').path, file('types.ag'));
  assert.equal(node('Base').text, 'state Base { int inherited; }');
});
test('legacy actor imports remain readable for old Studio projects without claiming compiler support', () => {
  const documents = [{ path: file('types.ag'), text: 'state S { int field; } actor Remote owns S {}' }];
  const result = analyze(request('import actor Remote from "types.ag"; actor C owns S { entry step() { self.| } }', documents));
  assert.ok(result.items.some(x => x.name === 'field'));
});

test('browser inspection reads module aliases, preserves qualified types and checks namespace calls', async () => {
  const { inspectLiveProject } = await import('../frontend/live-project.js');
  const { analyzeLive } = await import('../frontend/live-analysis.js');
  const { analyzeSemantics } = await import('../frontend/live-semantics.js');
  const { analyzeCalls } = await import('../frontend/live-call-checks.js');
  const text = 'import "types.ag" as lib; actor Local owns lib::Child { entry step() { require(count > 0); lib::Payload payload; lib::change(true); } }';
  const source = 'state Base { int count; } state Child expands Base {} state Payload {} fn change(int value) -> bool { return true; }';
  const project = await inspectLiveProject({ path: '/project/main.ag', root: '/project', text, documents: [{ path: '/project/types.ag', text: source }], invoke: async () => { throw Error('unsaved source should be used'); } });
  assert.equal(project.complete, true);
  assert.ok(project.symbols.some(s => s.name === 'lib::Child' && s.baseState === 'lib::Base'));
  assert.ok(!project.symbols.some(s => s.name === 'Child'));
  const analysis = analyzeLive(text);
  assert.ok(analysis.symbols.some(s => s.name === 'payload' && s.kind === 'variable'));
  assert.deepEqual(analyzeSemantics(text, analysis, project).filter(d => d.code === 'unknown-name'), []);
  assert.equal(analyzeCalls(text, analysis, project).filter(d => d.code === 'type-mismatch').length, 1);
  const incomplete = await inspectLiveProject({ path: '/project/main.ag', root: '/project', text: 'import "types.ag" as', invoke: async () => { throw Error('unfinished import must not read'); } });
  assert.equal(incomplete.hasImports, false);
});

test('browser alias self-import terminates with bounded symbol projection', async () => {
  const { inspectLiveProject } = await import('../frontend/live-project.js');
  const result = await inspectLiveProject({ path: '/project/main.ag', root: '/project', text: 'import "main.ag" as recursive; state S {}', invoke: async () => { throw Error('active source should be used'); } });
  assert.equal(result.complete, true);
  assert.ok(result.symbols.length <= 3);
});
