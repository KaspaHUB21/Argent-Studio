import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyMacRuntime,recordSignedMacRuntime,sha256} from '../scripts/macos-runtime-integrity.mjs';
function fixture(arch) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'argent-mac-receipt-'));
 const bin=path.join(root,'bin'),source=path.join(root,'toolchains/argent-master');
 fs.mkdirSync(path.join(bin,'runtime'),{recursive:true});fs.mkdirSync(path.join(source,'examples'),{recursive:true});
 fs.writeFileSync(path.join(source,'Cargo.lock'),'lock fixture');fs.writeFileSync(path.join(source,'examples/studio_test.rs'),'bridge fixture');
 const provenance={argent:{revision:'fixture-pin',cargoLockSha256:sha256(path.join(source,'Cargo.lock'))}};
 fs.writeFileSync(path.join(root,'toolchains/argent-provenance.json'),JSON.stringify(provenance));
 const binaries={};
 for(const [name,relative] of Object.entries({compiler:'argentc',testRunner:'ArgentTestRunner-v1',node:'runtime/node'})) {
  const file=path.join(bin,relative);fs.writeFileSync(file,'native '+name);binaries[name]={path:relative,sha256:sha256(file)};
 }
 fs.writeFileSync(path.join(bin,'toolchain-build.json'),JSON.stringify({platform:'darwin',arch,toolchain:provenance,bridgeSha256:sha256(path.join(source,'examples/studio_test.rs')),binaries}));
 return root;
}
for(const arch of ['arm64','x64'])test('macOS '+arch+' packaging requires intact native receipts and source pins',t=>{
 const root=fixture(arch);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.equal(verifyMacRuntime(root,{arch}).arch,arch);
 assert.throws(()=>verifyMacRuntime(root,{arch:arch==='arm64'?'x64':'arm64'}),/does not match/);
 fs.appendFileSync(path.join(root,'bin/ArgentTestRunner-v1'),'changed');
 assert.throws(()=>verifyMacRuntime(root,{arch}),/integrity failed: testRunner/);
});
test('Apple signing records changed bytes while preserving the original runtime digest',t=>{
 const root=fixture('arm64');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const original=verifyMacRuntime(root,{arch:'arm64'}).binaries.compiler.sha256;
 fs.appendFileSync(path.join(root,'bin/argentc'),'signed fixture');
 const signed=recordSignedMacRuntime(root,{arch:'arm64'});
 assert.equal(signed.binaries.compiler.unsignedSha256,original);
 assert.notEqual(signed.binaries.compiler.sha256,original);
 assert.equal(verifyMacRuntime(root,{arch:'arm64'}).binaries.compiler.sha256,signed.binaries.compiler.sha256);
 fs.appendFileSync(path.join(root,'toolchains/argent-master/examples/studio_test.rs'),'changed source');
 assert.throws(()=>verifyMacRuntime(root,{arch:'arm64'}),/bridge differs/);
});
test('macOS receipt validation rejects foreign platforms and modified compiler source pins',t=>{
 const root=fixture('x64');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'bin/toolchain-build.json'),receipt=JSON.parse(fs.readFileSync(file));
 receipt.platform='win32';fs.writeFileSync(file,JSON.stringify(receipt));
 assert.throws(()=>verifyMacRuntime(root,{arch:'x64'}),/does not match/);
 receipt.platform='darwin';receipt.toolchain.argent.revision='other-pin';fs.writeFileSync(file,JSON.stringify(receipt));
 assert.throws(()=>verifyMacRuntime(root,{arch:'x64'}),/provenance differs/);
});
