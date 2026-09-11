import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Run this check on macOS.');
const root=process.cwd(),reports=path.resolve('test-output/macos');fs.mkdirSync(reports,{recursive:true});
const bundle=path.resolve('src-tauri/target/release/bundle/macos/Argent Studio.app');
const exe=path.join(bundle,'Contents/MacOS/argent-studio-tauri');
const resources=path.join(bundle,'Contents/Resources/resources');
const env={...process.env,ARGENT_PROJECTS_DIR:path.join(reports,'projects')};
const summary={success:false,arch:process.arch,examples:[],backend:null,ui:null,errors:[]};
function run(exe,args,label){const r=spawnSync(exe,args,{env,encoding:'utf8',timeout:180000,maxBuffer:8000000});fs.writeFileSync(path.join(reports,label+'.txt'),(r.stdout||'')+'\n'+(r.stderr||''));if(r.error||r.status!==0)throw Error(label+': '+(r.error?.message||r.stderr||'exit '+r.status));return r;}
try{
 for(const file of [exe,path.join(resources,'bin/argentc'),path.join(resources,'bin/ArgentTestRunner-v1'),path.join(resources,'bin/runtime/node')]){fs.accessSync(file,fs.constants.X_OK);run('/usr/bin/file',[file],path.basename(file)+'-architecture');}
 for(const [id,entry,app] of [['tickets','tickets.ag','Tickets'],['spawns','spawns.ag','Spawns'],['stones','app.ag','Stones'],['icc','minter.ag','KCC20MintController']]){
  const output=path.join(reports,'examples',id);fs.mkdirSync(output,{recursive:true});
  run(path.join(resources,'bin/argentc'),['build',path.join(resources,'examples/catalog',id,entry),'--app',app,'--out',output],'example-'+id);
  JSON.parse(fs.readFileSync(path.join(output,'artifact.json'),'utf8'));summary.examples.push({id,success:true});
 }
 for(const [name,mode,option] of [['backend','--smoke-test','--smoke-report'],['ui','--ui-smoke','--ui-smoke-report']]){
  try {const report=path.join(reports,name+'.json');run(exe,[mode,option,report],name);summary[name]=JSON.parse(fs.readFileSync(report,'utf8'));if(!summary[name].success)throw Error(JSON.stringify(summary[name]));}
  catch(e){summary.errors.push(name+': '+e.message);}
 }
 summary.success=!summary.errors.length;
}catch(e){summary.errors.push(e.message);}finally{fs.writeFileSync(path.join(reports,'summary.json'),JSON.stringify(summary,null,2));}
console.log(JSON.stringify({success:summary.success,arch:summary.arch,examples:summary.examples,errors:summary.errors},null,2));
if(!summary.success)process.exitCode=1;
