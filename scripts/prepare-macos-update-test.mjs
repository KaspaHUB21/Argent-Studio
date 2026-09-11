// Disposable CI-only updater key/config. Never used in a published build.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin'||!process.env.CI)throw Error('Mac CI only');
const directory=path.resolve('test-output/updater');fs.mkdirSync(directory,{recursive:true});
const key=path.join(directory,'ephemeral.key');
const result=spawnSync(process.execPath,['node_modules/@tauri-apps/cli/tauri.js','signer','generate','--ci','--write-keys',key],{encoding:'utf8'});
if(result.status!==0)throw Error('Unable to generate disposable updater key');
fs.writeFileSync(path.join(directory,'tauri.test.json'),JSON.stringify({bundle:{createUpdaterArtifacts:false},plugins:{updater:{pubkey:fs.readFileSync(key+'.pub','utf8').trim(),endpoints:['http://127.0.0.1:17481/latest.json'],dangerousInsecureTransportProtocol:true}}}));
console.log('Prepared isolated updater configuration');
