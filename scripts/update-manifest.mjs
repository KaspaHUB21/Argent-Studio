import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function createManifest({version,notes,artifacts,published=new Date().toISOString(),required=['windows-x86_64']}) {
 if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)||!notes?.trim())throw Error('Release version and changelog required');
 const names={
  'windows-x86_64':`Argent-Studio-${version}-windows-x64-setup.exe`,
  'darwin-aarch64':`Argent-Studio-${version}-macos-arm64.app.tar.gz`,
  'darwin-x86_64':`Argent-Studio-${version}-macos-x64.app.tar.gz`,
 };
 const platforms={};
 for(const [platform,artifact] of Object.entries(artifacts)){
  if(!names[platform])throw Error('Unsupported update platform: '+platform);
  if(!fs.statSync(artifact).size)throw Error('Empty update artifact');
  const signature=fs.readFileSync(artifact+'.sig','utf8').trim();
  if(!signature)throw Error('Update signature missing');
  platforms[platform]={signature,url:`https://github.com/KaspaHUB21/Argent-Studio/releases/download/v${version}/${names[platform]}`};
 }
 for(const platform of required)if(!platforms[platform])throw Error('Required update platform missing: '+platform);
 return {version,notes,pub_date:published,platforms};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
 const bundle=path.resolve('src-tauri/target/release/bundle/nsis');
 const notes=fs.readFileSync('CHANGELOG.md','utf8').replace(/\r\n/g,'\n').split('## '+version+'\n')[1]?.split('\n## ')[0].trim();
 // Optional JSON input maps platform names to local, signed artifacts. It must
 // contain every supported release target, so a Mac upload cannot erase Windows.
 const input=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):null;
 const artifacts=input?.artifacts||{'windows-x86_64':path.join(bundle,`Argent Studio_${version}_x64-setup.exe`)};
 const required=input?['windows-x86_64','darwin-aarch64','darwin-x86_64']:['windows-x86_64'];
 const manifest=createManifest({version,notes,artifacts,required});
 const output=input?.output||path.join(bundle,'latest.json');
 fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n');
 console.log('Created update manifest for '+version);
}
