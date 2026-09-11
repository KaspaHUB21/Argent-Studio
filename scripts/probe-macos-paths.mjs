// Probe the unchanged scoped-read implementation without compiling the GUI.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('macOS probe only');
const root=path.resolve('test-output/macos-path-probe');fs.mkdirSync(path.join(root,'src'),{recursive:true});
const source=fs.readFileSync('src-tauri/src/ai_files.rs','utf8').replace('#[tauri::command]','');
fs.writeFileSync(path.join(root,'src/ai_files.rs'),source);
fs.writeFileSync(path.join(root,'Cargo.toml'),'[package]\nname="macos-path-probe"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nlibc="0.2"\ntempfile="3"\n');
fs.writeFileSync(path.join(root,'src/main.rs'),`
mod ai_files;
fn main(){
 let temp=tempfile::tempdir().unwrap();let root=temp.path();std::fs::write(root.join("ok.ag"),"public").unwrap();
 let canonical=std::fs::canonicalize(root).unwrap();
 let read=|p:&std::path::Path|ai_files::read_ai_file(p.to_string_lossy().into(),"ok.ag".into(),false);
 println!("temporary root: {}",root.display());println!("canonical root: {}",canonical.display());
 println!("temporary read: {:?}",read(root));println!("canonical read: {:?}",read(&canonical));
 assert_eq!(read(&canonical).unwrap().as_deref(),Some("public"));
 let outside=tempfile::tempdir().unwrap();std::fs::write(outside.path().join("secret.ag"),"PRIVATE").unwrap();
 std::os::unix::fs::symlink(outside.path(),canonical.join("linked")).unwrap();
 assert!(ai_files::read_ai_file(canonical.to_string_lossy().into(),"linked/secret.ag".into(),false).is_err());
 assert!(ai_files::read_ai_file(canonical.join("linked").to_string_lossy().into(),"secret.ag".into(),false).is_err());
 println!("Canonical-root read and rejection of linked project files/roots passed.");
}
`);
const r=spawnSync('cargo',['run','--manifest-path',path.join(root,'Cargo.toml')],{encoding:'utf8',timeout:180000,maxBuffer:2000000});
fs.writeFileSync(path.resolve('test-output/macos-path-probe.txt'),(r.stdout||'')+'\n'+(r.stderr||''));console.log(r.stdout);if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr);
