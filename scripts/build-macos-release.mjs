// Run on a Mac with a Developer ID Application identity installed in Keychain.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Release signing requires macOS');
const required=['APPLE_SIGNING_IDENTITY','TAURI_SIGNING_PRIVATE_KEY'];
for(const key of required)if(!process.env[key])throw Error('Missing release credential: '+key);
if(!process.env.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application:'))throw Error('Developer ID Application identity required');
const api=process.env.APPLE_API_ISSUER&&process.env.APPLE_API_KEY&&process.env.APPLE_API_KEY_PATH;
const account=process.env.APPLE_ID&&process.env.APPLE_PASSWORD&&process.env.APPLE_TEAM_ID;
if(!api&&!account)throw Error('Apple notarization credentials required');
function run(exe,args){const result=spawnSync(exe,args,{stdio:'inherit'});if(result.status!==0)throw Error('Release step failed: '+exe);}
for(const binary of ['resources/bin/argentc','resources/bin/ArgentTestRunner-v1','resources/bin/runtime/node']){
 fs.accessSync(binary,fs.constants.X_OK);
 const args=['--force','--options','runtime','--timestamp','--sign',process.env.APPLE_SIGNING_IDENTITY];
 if(binary.endsWith('/node'))args.push('--entitlements','scripts/node-macos-entitlements.plist');
 run('/usr/bin/codesign',[...args,binary]);
 run('/usr/bin/codesign',['--verify','--strict',binary]);
}
run(process.execPath,['node_modules/@tauri-apps/cli/tauri.js','build','--bundles','app,dmg']);
const bundle='src-tauri/target/release/bundle/macos/Argent Studio.app';
run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
run('/usr/bin/xcrun',['stapler','validate',bundle]);
run('/usr/sbin/spctl',['--assess','--type','execute','--verbose',bundle]);
console.log('Signed and notarized macOS release verified. Publication remains a separate step.');
