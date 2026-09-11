import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzeLive,liveContext} from '../frontend/live-analysis.js';
const at=(text,needle,offset=0)=>liveContext(text,text.indexOf(needle)+offset);
test('local completion is unique, scope-aware and ignores strings and comments',()=>{
 const text='fn calculate(int amount) -> int { int balance = amount; bal }';
 assert.equal(at(text,'bal }',3).completion.text,'balance');
 assert.equal(liveContext(text+'\n bal',text.length+5).completion,null);
 const comments='fn run() { int balance = 1; // bal\n "bal"; }';
 assert.equal(at(comments,'// bal',6).completion,null);
 assert.equal(at(comments,'"bal"',4).completion,null);
});
test('occurrences respect shadowing and skip properties, labels, comments and strings',()=>{
 const text='fn run(int value) { value; { int value = 2; value; } value; obj.value; {value: 1}; "value"; // value\n }';
 const context=at(text,'value;');
 assert.equal(context.occurrences.length,3);
 const inner=at(text,'value =');
 assert.equal(inner.occurrences.length,2);
 assert.equal(at(text,'obj.value',7).occurrences.length,0);
});
test('signature help uses declared types and counts nested argument commas correctly',()=>{
 const text='fn combine(byte[32] owner, int count) -> int { return count; } fn run() { combine(nested(1, 2), 3); }';
 const c=at(text,', 3',3);
 assert.equal(c.parameter.text,'combine(byte[32] owner, int count)');
 assert.equal(c.parameter.active,1);
 assert.equal(c.parameter.text.slice(c.parameter.ranges[1].from,c.parameter.ranges[1].to),'int count');
 assert.equal(at(text,'combine(nested',7).parameter,null);
 assert.equal(liveContext('unknown(1, ',11).parameter,null);
});
test('entry clauses place parameters in the implementation body, not the emits block',()=>{
 const text='actor Ticket { entry redeem(sig owner_sig) emits { next: Ticket, } { owner_sig; own } entry other() { owner_sig; } }';
 const c=at(text,'own }',3);
 assert.equal(c.completion.text,'owner_sig');
 assert.equal(at(text,'owner_sig;').occurrences.length,2);
 assert.equal(at(text,'owner_sig; }').occurrences.length,0);
 assert.equal(c.blocks.at(-1).label,'entry redeem');
});
test('delimiter diagnostics ignore strings/comments and only offer confident removals',()=>{
 assert.deepEqual(analyzeLive('fn run() { "}"; /* ) ] */ // }\n }').diagnostics,[]);
 const extra=analyzeLive('fn run() {} }').diagnostics;
 assert.equal(extra.length,1);assert.equal(extra[0].fix.insert,'');
 const missing=analyzeLive('fn run() {').diagnostics;
 assert.equal(missing.length,1);assert.equal(missing[0].fix,undefined);
 assert.ok(missing[0].messageDe&&missing[0].messageEn);
});
test('block context remains nested and signatures are absent inside their declaration',()=>{
 const text='actor A { entry go(int count) { if (count > 0) { count; } } }';
 assert.deepEqual(at(text,'count;').blocks.map(b=>b.label),['actor A','entry go','if (count > 0)']);
 assert.equal(at(text,'int count',5).parameter,null);
});
test('shipped AG sources have no local delimiter diagnostics',()=>{
 const root=new URL('../resources/examples/catalog/',import.meta.url);
 for(const path of fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.ag'))){const source=fs.readFileSync(new URL(path.replaceAll('\\','/'),root),'utf8');assert.equal(analyzeLive(source).diagnostics.length,0,path);}
});
test('pinned builtin signatures work while local declarations take precedence',()=>{
 const text='fn run() { checkSig(signature, public_key); }';
 const c=at(text,'public_key',3);
 assert.ok(c.parameter.text.startsWith('checkSig('));assert.equal(c.parameter.active,1);
 const shadow='fn run() { int checkSig = 1; checkSig(1); }';
 assert.equal(at(shadow,'checkSig(1',10).parameter,null);
 const completion='fn run() { blake2bWithKe }';assert.equal(at(completion,'blake2bWithKe',13).completion.text,'blake2bWithKey');
 const nested='fn run() { checkSig(unknown(1, 2), key); }';assert.equal(at(nested,'1, 2',4).parameter,null);
});
test('same-file owned fields resolve self references without confusing local shadowing',()=>{
 const text='state S { int count; } actor A owns S { entry go(int count) { count; self.count; } entry next() { count; } }';
 assert.equal(at(text,'int count; ',5).occurrences.length,3);
 assert.equal(at(text,'int count)',5).occurrences.length,2);
 assert.equal(at(text,'self.count',8).occurrences.length,3);
 const other='state S { int count; } actor A owns Missing { entry go() { self.count; } }';
 assert.equal(at(other,'self.count',8).occurrences.length,0);
});


test('self completion uses owned fields even when a local name shadows them',()=>{
 const text='state S { int balance; } actor A owns S { entry go(int balance) { self.bal } }';
 assert.equal(at(text,'self.bal',8).completion.text,'balance');
 const other=text.replace('self.bal','other.bal');assert.equal(at(other,'other.bal',9).completion,null);
});
test('numeric literal tails never resolve as identifier references',()=>{
 const text='fn run(int xdead, int e10) { 0xdead; 1e10; xdead; e10; }';
 assert.equal(at(text,'xdead; e10').occurrences.length,2);
 assert.equal(at(text,'e10; }').occurrences.length,2);
 assert.equal(at(text,'0xdead',4).occurrences.length,0);
});
test('array argument commas and nested call closing positions preserve active argument',()=>{
 const text='fn pair(byte[] bytes, int count) {} fn run() { pair([1, 2], 3); }';
 assert.equal(at(text,'1, 2',4).parameter.active,0);
 assert.equal(at(text,'], 3',4).parameter.active,1);
});
test('ambiguous local declarations do not fall back to a same-named builtin',()=>{
 const text='fn run() { int checkSig = 1; int checkSig = 2; checkSig(1); }';
 assert.equal(at(text,'checkSig(1',10).parameter,null);
 assert.equal(at(text,'checkSig(1',2).occurrences.length,0);
});
test('unfinished function headers cannot steal the next function body or leak parameters',()=>{
 const text='fn missing(int hidden)\nfn valid(int visible) { hidden; visible; }';
 assert.equal(at(text,'hidden;').occurrences.length,0);
 assert.deepEqual(at(text,'visible;').blocks.map(b=>b.label),['fn valid']);
 assert.equal(at(text,'visible;').occurrences.length,2);
 const prototype='fn missing(int hidden); fn valid() { hidden; }';
 assert.equal(at(prototype,'hidden;').occurrences.length,0);
});
test('observes and spawns clauses use the final implementation body for parameter scope',()=>{
 for(const relative of ['icc/minter.ag','spawns/spawns.ag']){
  const text=fs.readFileSync(new URL('../resources/examples/catalog/'+relative,import.meta.url),'utf8');
  const name=relative.startsWith('icc')?'minted_amount':'left_amount';
  const use=text.lastIndexOf(name),c=liveContext(text,use);
  assert.ok(c.occurrences.length>=2,relative);
  assert.equal(c.blocks.at(-1).label,relative.startsWith('icc')?'entry mint':'entry launch');
 }
});
test('unfinished quoted text or block comments do not trigger a cascade of brace errors',()=>{
 for(const text of ['fn run() { "unfinished\n }','fn run() { /* unfinished }']){
  const a=analyzeLive(text);assert.equal(a.diagnostics.length,1);assert.equal(a.diagnostics[0].fix,undefined);
  assert.ok(/String literal|Block comment/.test(a.diagnostics[0].messageEn));
 }
 assert.deepEqual(analyzeLive('fn run() { "escaped \\"quote\\""; }').diagnostics,[]);
});
test('cached analysis resolves a moderate document without cross-function matches',()=>{
 const text=Array.from({length:300},(_,i)=>`fn task${i}(int amount) {\n int balance = amount;\n if(balance > 0) {\n balance = balance + amount;\n }\n}\n`).join('');
 const analysis=analyzeLive(text),c=liveContext(text,text.lastIndexOf('balance'),analysis);
 assert.equal(c.occurrences.length,4);
 assert.equal(c.blocks[0].label,'fn task299');
 assert.equal(analysis.diagnostics.length,0);
});


test('record keys complete against state fields rather than overlapping local names',()=>{
 const source=fs.readFileSync(new URL('../resources/examples/catalog/tickets/tickets.ag',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const text=source.replace('redeemed: 1,','red');const pos=text.indexOf('            red\n')+'            red'.length;
 assert.equal(liveContext(text,pos).completion?.text,'redeemed');
 const simple='state S { int redeemed; int owner; } actor A owns S { entry redeem() { S redeemed_ticket = { owner: 1, red }; } }';
 assert.equal(liveContext(simple,simple.indexOf('red };')+3).completion?.text,'redeemed');
 const used=simple.replace('owner: 1, red','redeemed: 1, red');assert.equal(liveContext(used,used.indexOf('red };')+3).completion,null);
 const expression=simple.replace('owner: 1, red','owner: red');assert.equal(liveContext(expression,expression.indexOf('red };')+3).completion,null);
 const inherited='state Base { int redeemed; } state S expands Base { int owner; } fn go() { S result = { red }; }';
 assert.equal(liveContext(inherited,inherited.indexOf('red };')+3).completion?.text,'redeemed');
});
