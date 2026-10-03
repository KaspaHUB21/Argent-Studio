import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'lossless-json';
import {createProjectVerifier} from '../frontend/ai-project.js';
function fixture() {
 const state={root:'C:/project',epoch:0,share:true,settings:{aiEnabled:true},entry:'C:/project/main.ag',app:'Example',docs:[{path:'C:/project/main.ag',text:'unsaved main',generated:false}],files:[{path:'C:/project/main.ag'},{path:'C:/project/lib.ag'}],disk:{'main.ag':'saved main','lib.ag':'saved library'},calls:[]};
 const context={getProjectRoot:()=>state.root,getAccessEpoch:()=>state.epoch,isSharing:()=>state.share,getSettings:()=>state.settings,getDocuments:()=>state.docs,getDocument:()=>state.docs[0],getFiles:()=>state.files,getEntry:()=>state.entry,getAppName:()=>state.app,isWindows:()=>true,invoke:async(command,args)=>{
  state.calls.push({command,args});
  if(command==='read_ai_file')return state.disk[args.path]??null;
  if(command==='verify_ai_proposal'){await state.onVerify?.(args);return {success:true,compile:{success:true},tests:[]};}
  throw Error(command);
 }};
 return {state,context,verifier:createProjectVerifier(context)};
}
test('isolated verification combines open buffers and disk sources without writing',async()=>{
 const {state,verifier}=fixture();const result=await verifier.verify({path:'main.ag',content:'candidate',scenarios:parse('[{"value":9223372036854775807}]')});
 const {args}=state.calls.find(c=>c.command==='verify_ai_proposal');
 assert.equal(args.sources.find(s=>s.path==='main.ag').content,'candidate');assert.equal(args.sources.find(s=>s.path==='lib.ag').content,'saved library');assert.match(args.scenariosJson,/9223372036854775807/);
 assert.equal(state.docs[0].text,'unsaved main');assert.equal(state.disk['main.ag'],'saved main');assert.equal(await verifier.check(result),true);
 assert.equal(JSON.stringify(result).includes('saved library'),false);
 state.disk['lib.ag']='changed dependency';assert.equal(await verifier.check(result),false);
});
test('revocation and re-enabling during a source read cannot trigger compilation',async()=>{
 const {state,context}=fixture();const read=context.invoke;context.invoke=async(n,a)=>{const result=await read(n,a);if(n==='read_ai_file'){state.epoch+=2;state.share=true;}return result;};
 await assert.rejects(createProjectVerifier(context).verify({path:'main.ag',content:'candidate'}),/access disabled/);
 assert.equal(state.calls.some(c=>c.command==='verify_ai_proposal'),false);
});
test('dependency edits during compilation invalidate its result',async()=>{
 const {state,verifier}=fixture();state.onVerify=()=>{state.docs[0].text='edited during verification';};
 await assert.rejects(verifier.verify({path:'main.ag',content:'candidate'}),/changed during verification/);
});
test('verification checks project, entry and code permission again before Apply',async()=>{
 const {state,verifier}=fixture();const result=await verifier.verify();state.entry='C:/project/lib.ag';assert.equal(await verifier.check(result),false);state.entry='C:/project/main.ag';state.share=false;assert.equal(await verifier.check(result),false);state.share=true;state.root='C:/other';assert.equal(await verifier.check(result),false);
});
test('invalid paths and missing dependencies never start compiler',async()=>{
 const {state,verifier}=fixture();await assert.rejects(verifier.verify({path:'../outside.ag',content:'candidate'}),/relative/);delete state.disk['lib.ag'];await assert.rejects(verifier.verify(),/no longer exists/);assert.equal(state.calls.some(c=>c.command==='verify_ai_proposal'),false);
});

test('editor mutation after an earlier source read makes the entire snapshot stale',async()=>{
 const {state,context}=fixture();let revision=0;context.getRevision=()=>revision;const original=context.invoke;let active=false;
 context.invoke=async(n,a)=>{const result=await original(n,a);if(active&&n==='read_ai_file'&&a.path==='main.ag'){state.disk['lib.ag']='late edit';revision++;}return result;};
 const verifier=createProjectVerifier(context);const result=await verifier.verify();active=true;assert.equal(await verifier.check(result),false);
});
