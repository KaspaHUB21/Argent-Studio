// Integrity check shared by macOS packaging and native bundle smoke tests.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const binaryPaths = {compiler:'argentc',testRunner:'ArgentTestRunner-v1',node:'runtime/node'};
export function verifyMacRuntime(resources,{arch=process.arch}={}) {
 const bin=path.join(resources,'bin');
 const receipt=JSON.parse(fs.readFileSync(path.join(bin,'toolchain-build.json'),'utf8'));
 const provenance=JSON.parse(fs.readFileSync(path.join(resources,'toolchains/argent-provenance.json'),'utf8'));
 if(receipt.platform!=='darwin'||receipt.arch!==arch)throw Error('Runtime receipt does not match macOS/'+arch);
 if(JSON.stringify(receipt.toolchain)!==JSON.stringify(provenance))throw Error('Runtime toolchain provenance differs from bundled source');
 const source=path.join(resources,'toolchains/argent-master');
 if(sha256(path.join(source,'Cargo.lock'))!==provenance.argent.cargoLockSha256)throw Error('Bundled Argent Cargo.lock does not match provenance');
 if(sha256(path.join(source,'examples/studio_test.rs'))!==receipt.bridgeSha256)throw Error('Bundled Studio VM bridge differs from runtime receipt');
 for(const [name,expected] of Object.entries(binaryPaths)) {
  const binary=receipt.binaries?.[name];
  if(binary?.path!==expected||sha256(path.join(bin,expected))!==binary.sha256)throw Error('Bundled runtime integrity failed: '+name);
 }
 return receipt;
}
// Apple signing changes Mach-O bytes. Retain their pre-signing digest and record
// the signed bytes before Tauri copies the resources into the application.
export function recordSignedMacRuntime(resources,{arch=process.arch}={}) {
 const bin=path.join(resources,'bin'),file=path.join(bin,'toolchain-build.json');
 const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const [name,relative] of Object.entries(binaryPaths)) {
  const binary=receipt.binaries[name];
  binary.unsignedSha256 ||= binary.sha256;
  binary.sha256=sha256(path.join(bin,relative));
 }
 receipt.appleSignedAt=new Date().toISOString();
 fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n');
 return verifyMacRuntime(resources,{arch});
}
