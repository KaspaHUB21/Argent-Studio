import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeLive} from '../frontend/live-analysis.js';
import {analyzeSemantics} from '../frontend/live-semantics.js';
import {analyzeCalls} from '../frontend/live-call-checks.js';
import {inspectLiveProject} from '../frontend/live-project.js';
function fixture(text,files={},options={}){const calls=[];const invoke=async(command,args)=>{calls.push({command,args});assert.equal(command,'read_ai_file');const full=args.projectRoot.replace(/\/$/,'')+'/'+args.path;if(files[full] instanceof Error)throw files[full];return files[full]??null;};return {calls,run:()=>inspectLiveProject({path:'/project/main.ag',root:'/project',text,documents:[],invoke,...options})};}
test('missing import file reports its path only after a confirmed scoped miss',async()=>{
 const f=fixture('import "./missing.ag";');const r=await f.run();assert.equal(r.diagnostics[0].code,'import-missing');assert.equal(r.complete,false);assert.equal(r.hasImports,true);assert.deepEqual(f.calls[0],{command:'read_ai_file',args:{projectRoot:'/project',path:'missing.ag',allowMissing:true}});
 const restricted=await fixture('import "./secret.ag";',{'/project/secret.ag':Error('permission denied')}).run();assert.deepEqual(restricted.diagnostics,[]);assert.equal(restricted.complete,false);
});
test('existing modules expose typed functions and state metadata',async()=>{
 const r=await fixture('import "./types.ag";',{'/project/types.ag':'state Base { int count; } state S expands Base { byte[32] owner; actor_type<Base> handle; } fn change(byte[32] owner, int amount) -> bool { return true; }'}).run();
 assert.equal(r.complete,true);assert.deepEqual(r.diagnostics,[]);const fn=r.symbols.find(s=>s.name==='change');assert.deepEqual(fn.params,[{name:'owner',type:'byte[32]'},{name:'amount',type:'int'}]);assert.equal(fn.returnType,'bool');const state=r.symbols.find(s=>s.name==='S');assert.equal(state.baseState,'Base');assert.deepEqual(state.fields.map(f=>[f.name,f.type]),[['owner','byte[32]'],['handle','actor_type<Base>']]);
});
test('named actor imports include only that actor and diagnose an absent actor',async()=>{
 const source='state S { int count; } actor Ticket owns S { entry run() {} }';
 const good=await fixture('import actor Ticket from "./ticket.ag";',{'/project/ticket.ag':source}).run();assert.deepEqual(good.symbols.map(s=>s.name),['Ticket']);assert.equal(good.symbols[0].owns,'S');
 const bad=await fixture('import actor Missing from "./ticket.ag";',{'/project/ticket.ag':source}).run();assert.equal(bad.diagnostics[0].code,'import-name');assert.equal(bad.diagnostics[0].from,13);
 const uncertain=await fixture('import actor Missing from "./ticket.ag";',{'/project/ticket.ag':'actor Ticket {'}).run();assert.deepEqual(uncertain.diagnostics,[]);assert.equal(uncertain.complete,false);
});
test('unsaved open documents override disk and circular imports terminate',async()=>{
 const f=fixture('import "./other.ag";',{}, {documents:[{path:'/project/other.ag',text:'import "./main.ag"; fn unsaved(int value) -> int { return value; }'}]});const r=await f.run();assert.deepEqual(r.symbols.map(s=>s.name),['unsaved']);assert.equal(f.calls.length,0);assert.equal(r.complete,true);
});
test('outside paths never read even when an outside document is open',async()=>{
 const f=fixture('import "../private.ag"; import "/outside.ag"; import "C:/outside.ag";',{}, {documents:[{path:'/private.ag',text:'fn private() {}'}]});const r=await f.run();assert.equal(f.calls.length,0);assert.equal(r.complete,false);assert.deepEqual(r.diagnostics,[]);
 const sibling=fixture('import "../project-other/secret.ag";');await sibling.run();assert.equal(sibling.calls.length,0);
});
test('explicit standard library uses its own scoped boundary and no other std path',async()=>{
 const f=fixture('import "std::core";',{'/resources/std/core.ag':'fn invocation_uid(byte[] domain) -> byte[32] { return domain; }'}, {standardLibrary:'/resources/std/core.ag'});const r=await f.run();assert.equal(r.symbols[0].name,'invocation_uid');assert.deepEqual(f.calls[0].args,{projectRoot:'/resources/std',path:'core.ag',allowMissing:false});
 const other=fixture('import "std::unknown";',{}, {standardLibrary:'/resources/std/core.ag'});assert.equal((await other.run()).complete,false);assert.equal(other.calls.length,0);
});
test('comments, strings and incomplete import statements do not trigger filesystem reads',async()=>{
 const f=fixture('// import "no.ag";\nfn run() { "import \\"fake.ag\\";"; }\nimport "unfinished.ag"');const r=await f.run();assert.equal(f.calls.length,0);assert.equal(r.hasImports,false);
});
test('bounded import traversal stops without claiming remaining files are missing',async()=>{
 const files={};for(let i=0;i<100;i++)files['/project/'+i+'.ag']=`import "./${i+1}.ag"; fn fn${i}() {}`;
 const f=fixture('import "./0.ag";',files);const r=await f.run();assert.ok(f.calls.length<=80);assert.equal(r.complete,false);assert.deepEqual(r.diagnostics,[]);
 const large=fixture('import "./large.ag";',{'/project/large.ag':' '.repeat(2*1024*1024+1)});assert.equal((await large.run()).complete,false);
});
test('Windows project paths and unsaved documents compare case-insensitively',async()=>{
 const calls=[];const r=await inspectLiveProject({path:'C:\\Project\\main.ag',root:'C:\\Project',text:'import "./other.ag";',documents:[{path:'c:/project/OTHER.ag',text:'fn saved() {}'}],invoke:async(...args)=>{calls.push(args);throw Error('unexpected');}});assert.equal(r.symbols[0].name,'saved');assert.equal(calls.length,0);
});

test('unsupported network roots stay incomplete instead of being rewritten to another path',async()=>{
 let reads=0;const r=await inspectLiveProject({path:'//server/project/main.ag',root:'//server/project',text:'import "./other.ag";',invoke:async()=>{reads++;return null;}});
 assert.equal(r.complete,false);assert.equal(reads,0);assert.deepEqual(r.diagnostics,[]);
});

test('invalid named imports stay incomplete and avoid unknown-name cascades',async()=>{
 const text='import actor Missing from "./other.ag"; fn run() { unavailable; }';
 const result=await fixture(text,{'/project/other.ag':'actor Other { entry run() {} }'}).run();
 assert.equal(result.complete,false);assert.equal(result.diagnostics.length,1);
 assert.equal(result.diagnostics[0].messageDe,'Akteur \u201eMissing\u201c ist in diesem Import nicht definiert.');
 assert.ok(!analyzeSemantics(text,analyzeLive(text),result).some(d=>d.code==='unknown-name'));
});
test('resolved shipped project imports produce no erroneous semantic or call errors',async()=>{
 const catalog=fileURLToPath(new URL('../resources/examples/catalog/',import.meta.url));
 const standard=fileURLToPath(new URL('../resources/toolchains/argent-master/std/core.ag',import.meta.url));
 for(const project of fs.readdirSync(catalog)){
  const root=path.join(catalog,project);if(!fs.statSync(root).isDirectory())continue;
  const documents=fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.ag')).map(p=>({path:path.join(root,p),text:fs.readFileSync(path.join(root,p),'utf8')}));
  for(const document of documents){
   const result=await inspectLiveProject({...document,root,documents,standardLibrary:standard,invoke:async(command,args)=>{
    assert.equal(command,'read_ai_file');const candidate=path.resolve(args.projectRoot,args.path),allowed=path.resolve(args.projectRoot);assert.ok(candidate.startsWith(allowed+path.sep));
    return fs.existsSync(candidate)?fs.readFileSync(candidate,'utf8'):null;
   }});
   assert.equal(result.complete,true,document.path);assert.deepEqual(result.diagnostics,[],document.path);
   const analysis=analyzeLive(document.text),diagnostics=[...analyzeSemantics(document.text,analysis,result),...analyzeCalls(document.text,analysis,result)].filter(d=>d.severity!=='warning');
   assert.deepEqual(diagnostics,[],document.path);
  }
 }
});
