import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
test('Windows auto-CRLF checkout preserves pinned lockfile, bridge and embedded skill bytes',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'argent-source-checkout-'));
 const files=['resources/toolchains/argent-master/Cargo.lock','resources/toolchains/argent-master/examples/studio_test.rs','resources/ai/covenants/SKILL.md'];
 const git=(...args)=>{const result=spawnSync('git',args,{cwd:directory,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
 try{
  git('init','--quiet');git('config','core.autocrlf','true');git('config','core.safecrlf','false');
  for(const file of ['.gitattributes','resources/toolchains/argent-master/.gitattributes',...files]){const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(new URL(file,root),target);}
  git('add','.');for(const file of files)fs.unlinkSync(path.join(directory,file));git('checkout-index','--all','--force');
  for(const file of files){const expected=fs.readFileSync(new URL(file,root));assert.deepEqual(fs.readFileSync(path.join(directory,file)),expected,file);}
  const provenance=JSON.parse(fs.readFileSync(new URL('resources/toolchains/argent-provenance.json',root)));const hash=createHash('sha256').update(fs.readFileSync(path.join(directory,files[0]))).digest('hex');assert.equal(hash,provenance.argent.cargoLockSha256);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
