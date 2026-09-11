import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeLive} from '../frontend/live-analysis.js';
import {analyzeCalls} from '../frontend/live-call-checks.js';
const check=(text,project)=>analyzeCalls(text,analyzeLive(text),project);
test('completed calls count nested calls and arrays as single arguments',()=>{
 assert.equal(check('fn sum(int a, int b) -> int { return a; } fn run() { sum(1); }').filter(d=>d.code==='argument-count').length,1);
 assert.equal(check('fn sum(int a, int b) -> int { return a; } fn run() { sum(sum(1, 2), 3); }').length,0);
 assert.equal(check('fn list(int[] a, int b) {} fn run() { list([1, 2], 3); }').length,0);
 assert.equal(check('fn sum(int a) {} fn run() { sum(1,').length,0);
});
test('types are checked only when primitive types are certain',()=>{
 const diagnostics=check('fn use(int a) -> int { int n = false; use(true); return false; }');
 assert.equal(diagnostics.filter(d=>d.code==='type-mismatch').length,3);
 assert.equal(check('fn use(int a) {} fn run(bool b) { use(b); }').filter(d=>d.code==='type-mismatch').length,1);
 assert.equal(check('fn use(byte[] a) {} fn run(byte[32] b) { use(b); }').length,0);
 assert.equal(check('fn use(int a) {} fn run() { use(unknown.x); }').length,0);
});
test('return flow handles branches, trailing statements and uncertain loops',()=>{
 assert.equal(check('fn f(bool b) -> int { if (b) { return 1; } else { return 2; } }').length,0);
 assert.equal(check('fn f(bool b) -> int { if (b) { return 1; } }').filter(d=>d.code==='missing-return').length,1);
 const result=check('fn f() -> int { return 1; int n = 2; }');assert.equal(result.filter(d=>d.code==='unreachable-code'&&d.fade).length,1);
 assert.equal(check('fn f() -> int { for (i, 0, 2) { return i; } }').filter(d=>d.code==='missing-return').length,0);
 assert.equal(check('fn f() -> int { int n =').length,0);
});
test('binding and namespace ambiguity suppresses call assumptions',()=>{
 assert.equal(check('fn f(int a) {} fn run() { int f = 1; f(); obj.f(); }').length,0);
 assert.equal(check('fn run() { foreign(true); }',{symbols:[{name:'foreign',kind:'fn',signature:{text:'foreign(int n)'}}]}).filter(d=>d.code==='type-mismatch').length,1);
 assert.equal(check('fn run() { foreign(); }',{symbols:[{name:'foreign',kind:'fn',signature:'foreign(int n)'},{name:'foreign',kind:'fn',signature:'foreign()'}]}).length,0);
});
test('pinned example catalog has no call/type/control-flow diagnostics',()=>{
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):e.name.endsWith('.ag')?[join(dir,e.name)]:[]);
 const files=walk(fileURLToPath(new URL('../resources/examples/',import.meta.url)));assert.ok(files.length>0);
 for(const file of files)assert.deepEqual(check(readFileSync(file,'utf8')),[],file);
});



test('string arguments count without interpreting their content as code',()=>{
 assert.equal(check('fn use(string a, int b) {} fn run() { use("a,b", 1); }').length,0);
 assert.equal(check('fn use(string a, int b) {} fn run() { use("a,b"); }').filter(d=>d.code==='argument-count').length,1);
 assert.equal(check('fn use(string a) {} fn run() { use(/* still typing */); }').filter(d=>d.code==='argument-count').length,1);
});

test('empty typed returns warn and unfinished syntax stays quiet',()=>{
 assert.equal(check('fn f() -> int { return; }').filter(d=>d.code==='missing-return-value').length,1);
 assert.equal(check('fn f() -> string { return "ok"; }').length,0);
 assert.equal(check('fn f() -> int { return; } actor Incomplete {').length,0);
 assert.equal(check('fn f() -> int { match (unknown) { x: 1; }; }').filter(d=>d.code==='missing-return').length,0);
});

test('imported declared return types drive assignment and nested argument checks',()=>{
 const project={symbols:[{name:'foreign',kind:'fn',signature:{text:'foreign(int n)',ranges:[]},params:[{name:'n',type:'int'}],returnType:'int'}]};
 const result=check('fn use(bool b) {} fn run() { bool b = foreign(1); use(foreign(1)); }',project);
 assert.equal(result.filter(d=>d.code==='type-mismatch').length,2);
 assert.equal(check('fn run() { int n = foreign(1); }',project).length,0);
});
