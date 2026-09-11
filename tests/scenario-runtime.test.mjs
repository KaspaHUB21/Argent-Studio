import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ScenarioSchema,diagnoseFailure} from '../frontend/transactions.js';
const suffix=process.platform==='win32'?'.exe':'';
const runner=fileURLToPath(new URL('../resources/bin/ArgentTestRunner-v1'+suffix,import.meta.url));
const compiler=fileURLToPath(new URL('../resources/bin/argentc'+suffix,import.meta.url));
const buildRoot=fileURLToPath(new URL('../test-output/scenario-runtime/',import.meta.url));
let artifactPath=null;
if(fs.existsSync(compiler)&&fs.existsSync(runner)){
 fs.mkdirSync(buildRoot,{recursive:true});
 const compiled=spawnSync(compiler,['build',fileURLToPath(new URL('../resources/examples/catalog/tickets/tickets.ag',import.meta.url)),'--out',buildRoot],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(compiled.status,0,compiled.stderr);
 artifactPath=buildRoot+'/artifact.json';
}
test('ported scenario fields execute in the real local VM and diagnostics find the valid successor',{skip:!artifactPath||!fs.existsSync(runner)},async()=>{const schema=new ScenarioSchema(JSON.parse(fs.readFileSync(artifactPath,'utf8'))),scenario=schema.create('Ticket','redeem');function run(value){const result=spawnSync(runner,[],{input:JSON.stringify({artifact:artifactPath,scenario:value}),encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}const failed=run(scenario);assert.equal(failed.status,'failed');const diagnosis=await diagnoseFailure(async value=>run(value),scenario,failed);assert.equal(diagnosis.status,'failed');assert.equal(diagnosis.verified_alternative?.field,'redeemed');assert.equal(diagnosis.verified_alternative?.to,1);assert.equal(scenario.outputs[0].state.redeemed,0);scenario.outputs[0].state.redeemed=1;assert.equal(run(scenario).status,'passed');});
