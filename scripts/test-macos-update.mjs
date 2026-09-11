import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawnSync,spawn} from 'node:child_process';
if(process.platform!=='darwin'||!process.env.CI)throw Error('Mac CI only');
const root=path.resolve('test-output/updater'),source=path.resolve('src-tauri/target/release/bundle/macos/Argent Studio.app');
const candidate=path.join(root,'candidate','Argent Studio.app'),installed=path.join(root,'installed','Argent Studio.app');
fs.cpSync(source,candidate,{recursive:true});fs.cpSync(source,installed,{recursive:true});
const marker='Contents/Resources/update-test-marker.txt';fs.writeFileSync(path.join(candidate,marker),'replacement verified');
const archive=path.join(root,'update.app.tar.gz');
function run(exe,args,options={}){const r=spawnSync(exe,args,{encoding:'utf8',timeout:180000,...options});if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr);return r;}
run('/usr/bin/codesign',['--force','--sign','-',candidate]);
run('/usr/bin/tar',['-czf',archive,'-C',path.dirname(candidate),'Argent Studio.app']);
run(process.execPath,['node_modules/@tauri-apps/cli/tauri.js','signer','sign','--private-key-path',path.join(root,'ephemeral.key'),archive],{env:{...process.env,TAURI_SIGNING_PRIVATE_KEY_PASSWORD:''}});
const signature=fs.readFileSync(archive+'.sig','utf8').trim(),platform='darwin-'+(process.arch==='arm64'?'aarch64':'x86_64');
const manifest={version:'99.0.0',notes:'Isolated update test',pub_date:new Date().toISOString(),platforms:{[platform]:{signature,url:'http://127.0.0.1:17481/update.tar.gz'}}};
const server=http.createServer((req,res)=>{if(req.url==='/latest.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));}else if(req.url==='/update.tar.gz'){res.setHeader('Content-Length',fs.statSync(archive).size);fs.createReadStream(archive).pipe(res);}else{res.statusCode=404;res.end();}});
function runApp(exe,args){return new Promise((resolve,reject)=>{const child=spawn(exe,args,{env:{...process.env,ARGENT_PROJECTS_DIR:path.join(root,'projects')},stdio:'inherit'});const timer=setTimeout(()=>{child.kill();reject(Error('Application test timed out'));},180000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});}
await new Promise(resolve=>server.listen(17481,'127.0.0.1',resolve));
try{
 const exe=path.join(installed,'Contents/MacOS/argent-studio-tauri'),report=path.join(root,'verification.json');
 const ipcReport=path.join(root,'ipc.json');
 const ipcCode=await runApp(exe,['--ui-smoke','--ui-update-check','--ui-smoke-report',ipcReport]);
 if(ipcCode!==0||!JSON.parse(fs.readFileSync(ipcReport,'utf8')).updaterIpcChecked)throw Error('Native updater IPC failed');
 const userFile=path.join(root,'projects/tickets/tickets.ag');fs.appendFileSync(userFile,'\n// preserved through native update\n');
 const code=await new Promise((resolve,reject)=>{const child=spawn(exe,['--verify-update','--ci-install-update','--verify-update-report',report],{env:{...process.env,ARGENT_PROJECTS_DIR:path.join(root,'projects')},stdio:'inherit'});const timer=setTimeout(()=>{child.kill();reject(Error('Updater timed out'));},180000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
 const result=JSON.parse(fs.readFileSync(report,'utf8'));if(code!==0||!result.success||!result.installed||!result.tamperedSignatureRejected)throw Error(JSON.stringify(result));
 if(fs.readFileSync(path.join(installed,marker),'utf8')!=='replacement verified')throw Error('Replacement marker missing');
 run(exe,['--ui-smoke','--ui-smoke-report',path.join(root,'relaunch.json')],{env:{...process.env,ARGENT_PROJECTS_DIR:path.join(root,'projects')}});
 if(!JSON.parse(fs.readFileSync(path.join(root,'relaunch.json'),'utf8')).success)throw Error('Updated application did not relaunch');
 if(!fs.readFileSync(userFile,'utf8').includes('// preserved through native update'))throw Error('Update or relaunch lost user project changes');
 const exitReport=path.join(root,'exit.json');
 const exitCode=await runApp(exe,['--ui-smoke','--ui-exit-check','--ui-smoke-report',exitReport]);
 const exitResult=JSON.parse(fs.readFileSync(exitReport,'utf8'));
 if(exitCode!==0||!exitResult.exitGuardChecked||!fs.readFileSync(path.join(root,'projects/tickets/tickets.ag'),'utf8').includes('// native quit saved'))throw Error('Native quit confirmation did not preserve and save changes');
 fs.writeFileSync(exitReport,JSON.stringify({...exitResult,pendingExit:false,savedAndExited:true},null,2));
 console.log('Native quit cancellation, save and exit passed');
 console.log('Signed download, tamper rejection, in-place replacement and relaunch passed');
}finally{await new Promise(resolve=>server.close(resolve));}
