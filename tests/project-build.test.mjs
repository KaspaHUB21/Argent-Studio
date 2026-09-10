import test from 'node:test';
import assert from 'node:assert/strict';
import {readProjectBuild} from '../frontend/project-build.js';
const root='C:/project';
const dir=(path)=>({name:path.split('/').pop(),path,isDirectory:true});
const file=(path)=>({name:path.split('/').pop(),path,isDirectory:false});
function fixture(latest=[]) {
 const lists={ [root]:[dir(root+'/build')], [root+'/build']:[dir(root+'/build/9'),dir(root+'/build/10'),dir(root+'/build/.archive')], [root+'/build/10']:latest };
 return async (command,args)=> {
  if(command==='list_directory') {assert.ok(args.path in lists,'Only latest build should be read');return lists[args.path];}
  if(command==='read_file')return args.path.endsWith('.log')?'saved log':'{}';
  assert.fail(command);
 };
}
test('saved project builds choose newest numeric directory and remain stale',async()=>{
 const result=await readProjectBuild(root,fixture(['artifact.json','manifest.json','New.sil','editor-build.log'].map(n=>file(root+'/build/10/'+n))));
 assert.equal(result.output,root+'/build/10');assert.equal(result.success,true);assert.equal(result.stale,true);assert.equal(result.stdout,'saved log');
});
test('empty newest build does not fall back to earlier successful files',async()=>assert.equal(await readProjectBuild(root,fixture()),null));
test('incomplete newest build retains its files without claiming success',async()=>{
 const result=await readProjectBuild(root,fixture([file(root+'/build/10/New.sil')]));assert.equal(result.success,false);assert.equal(result.files.length,1);
});
test('projects without build folders do not read another directory',async()=>{
 assert.equal(await readProjectBuild(root,async(command,args)=>{assert.equal(args.path,root);return [];}),null);
});
