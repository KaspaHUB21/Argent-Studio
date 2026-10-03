//! Local bounded editor checkpoints. Restoring returns text; never writes project files.
use std::{path::{Path,PathBuf}, sync::Mutex, time::{SystemTime,UNIX_EPOCH}, io::Write};
use serde::{Serialize,Deserialize};
const MAX_TEXT:usize=640_000;
const MAX_STORE:usize=4_000_000;
const MAX_ENTRIES:usize=50;
static LOCK:Mutex<()>=Mutex::new(());
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct HistoryEntry {pub id:String,pub created_at:u64,pub reason:String,pub bytes:usize}
#[derive(Serialize,Deserialize)] struct Snapshot {#[serde(flatten)] entry:HistoryEntry,text:String}
#[derive(Serialize,Deserialize)] struct Store {root:String,path:String,snapshots:Vec<Snapshot>}
fn error(e:impl std::fmt::Display)->String{e.to_string()}
fn hash(s:&str)->u64{s.bytes().fold(14695981039346656037u64,|h,b|(h^b as u64).wrapping_mul(1099511628211))}
fn unlinked(p:&Path)->Result<(),String>{
 if let Ok(m)=std::fs::symlink_metadata(p){
  if m.file_type().is_symlink(){return Err("Linked history paths are unsupported".into());}
  #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if m.file_attributes()&0x400!=0{return Err("Linked history paths are unsupported".into());}}
 }Ok(())
}
fn location(data:&Path,root:&str,path:&str)->Result<(PathBuf,String,String),String>{
 // Reuse handle-based containment checks, including Windows reparse-point protections.
 crate::ai_files::read_ai_file(root.into(),path.into(),true)?;
 if !path.ends_with(".ag"){return Err("Code history requires an Argent source file".into());}
 let root=std::fs::canonicalize(root).map_err(error)?.to_string_lossy().into_owned();
 let path=path.replace('\\',"/");
 #[cfg(windows)] let root=root.to_lowercase();
 #[cfg(windows)] let path=path.to_lowercase();
 let directory=data.join("code-history");unlinked(&directory)?;
 std::fs::create_dir_all(&directory).map_err(error)?;
 let file=directory.join(format!("{:016x}-{:016x}.json",hash(&root),hash(&path)));unlinked(&file)?;
 Ok((file,root,path))
}
fn load(file:&Path,root:String,path:String)->Result<Store,String>{
 match std::fs::metadata(file){
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(Store{root,path,snapshots:vec![]}),
  Err(e)=>Err(error(e)),
  Ok(m)=>{if !m.is_file()||m.len()>5_000_000{return Err("Invalid history store".into());}
   let store:Store=serde_json::from_slice(&std::fs::read(file).map_err(error)?).map_err(error)?;
   if store.root!=root||store.path!=path||store.snapshots.len()>MAX_ENTRIES||store.snapshots.iter().any(|s|s.text.len()>MAX_TEXT)||store.snapshots.iter().map(|s|s.text.len()).sum::<usize>()>MAX_STORE{return Err("History identity mismatch".into());}Ok(store)}
 }
}
fn entries(store:&Store)->Vec<HistoryEntry>{store.snapshots.iter().rev().map(|s|s.entry.clone()).collect()}
pub fn list(data:&Path,root:&str,path:&str)->Result<Vec<HistoryEntry>,String>{let _guard=LOCK.lock().map_err(error)?;let (file,root,path)=location(data,root,path)?;Ok(entries(&load(&file,root,path)?))}
pub fn read(data:&Path,root:&str,path:&str,id:&str)->Result<String,String>{let _guard=LOCK.lock().map_err(error)?;let (file,root,path)=location(data,root,path)?;let store=load(&file,root,path)?;store.snapshots.into_iter().find(|s|s.entry.id==id).map(|s|s.text).ok_or_else(||"History entry no longer available".into())}
pub fn checkpoint(data:&Path,root:&str,path:&str,text:&str,reason:&str)->Result<Vec<HistoryEntry>,String>{
 if text.len()>MAX_TEXT{return Err("Code history snapshot exceeds 640 KB".into());}
 let _guard=LOCK.lock().map_err(error)?;let (file,root,path)=location(data,root,path)?;let mut store=load(&file,root,path)?;
 let clean_reason:String=reason.chars().filter(|c|!c.is_control()).take(80).collect();
 if store.snapshots.last().is_some_and(|s|s.text==text){
  // Debounced edit may precede its explicit Save/AI checkpoint. Promote the label
  // without creating another identical source version or losing its original ID.
  let rank=|r:&str|match r{"ai"|"restored"=>2,"saved"=>1,_=>0};
  let last=store.snapshots.last_mut().ok_or("History entry missing")?;
  if rank(&clean_reason)<=rank(&last.entry.reason){return Ok(entries(&store));}
  last.entry.reason=clean_reason;
 }else{
  let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(error)?;
  let entry=HistoryEntry{id:now.as_nanos().to_string(),created_at:now.as_millis() as u64,reason:clean_reason,bytes:text.len()};
  store.snapshots.push(Snapshot{entry,text:text.into()});
 }
 while store.snapshots.len()>MAX_ENTRIES||store.snapshots.iter().map(|s|s.text.len()).sum::<usize>()>MAX_STORE {store.snapshots.remove(0);}
 // Keep the serialized file bounded too: JSON escaping can enlarge source text.
 let mut bytes=serde_json::to_vec(&store).map_err(error)?;
 while bytes.len()>MAX_STORE&&store.snapshots.len()>1{store.snapshots.remove(0);bytes=serde_json::to_vec(&store).map_err(error)?;}
 if bytes.len()>MAX_STORE{return Err("Code history store exceeds 4 MB".into());}
 let mut temp=tempfile::NamedTempFile::new_in(file.parent().ok_or("History directory missing")?).map_err(error)?;
 temp.write_all(&bytes).map_err(error)?;temp.as_file().sync_all().map_err(error)?;unlinked(&file)?;
 temp.persist(&file).map_err(error)?;Ok(entries(&store))
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn persistent_deduplicated_and_separated(){let t=tempfile::tempdir().unwrap();let data=t.path().join("data");let a=t.path().join("a");let b=t.path().join("b");std::fs::create_dir_all(&a).unwrap();std::fs::create_dir_all(&b).unwrap();let a=a.to_str().unwrap();let b=b.to_str().unwrap();let e=checkpoint(&data,a,"main.ag","draft","draft").unwrap();assert_eq!(checkpoint(&data,a,"main.ag","draft","save").unwrap().len(),1);assert_eq!(read(&data,a,"main.ag",&e[0].id).unwrap(),"draft");assert!(list(&data,b,"main.ag").unwrap().is_empty());assert!(!Path::new(a).join("main.ag").exists());}
 #[test]fn explicit_reason_promotes_duplicate_without_new_id(){let t=tempfile::tempdir().unwrap();let data=t.path().join("data");let root=t.path().to_str().unwrap();let edit=checkpoint(&data,root,"main.ag","candidate","edit").unwrap();let ai=checkpoint(&data,root,"main.ag","candidate","ai").unwrap();assert_eq!(ai.len(),1);assert_eq!(ai[0].id,edit[0].id);assert_eq!(ai[0].reason,"ai");let saved=checkpoint(&data,root,"main.ag","candidate","saved").unwrap();assert_eq!(saved[0].id,edit[0].id);assert_eq!(saved[0].reason,"ai");assert_eq!(list(&data,root,"main.ag").unwrap()[0].reason,"ai");let saved=checkpoint(&data,root,"other.ag","draft","edit").unwrap();let explicit=checkpoint(&data,root,"other.ag","draft","saved").unwrap();assert_eq!(saved[0].id,explicit[0].id);assert_eq!(explicit[0].reason,"saved");}
 #[test]fn bounds_and_traversal(){let t=tempfile::tempdir().unwrap();let data=t.path().join("data");let root=t.path().to_str().unwrap();for n in 0..55{checkpoint(&data,root,"main.ag",&n.to_string(),"draft").unwrap();}assert_eq!(list(&data,root,"main.ag").unwrap().len(),50);assert!(checkpoint(&data,root,"../escape.ag","bad","draft").is_err());assert!(checkpoint(&data,root,"main.txt","bad","draft").is_err());assert!(checkpoint(&data,root,"main.ag",&"x".repeat(MAX_TEXT+1),"draft").is_err());}
 #[test]fn corrupt_store_is_not_overwritten(){let t=tempfile::tempdir().unwrap();let data=t.path().join("data");let root=t.path().to_str().unwrap();let(file,_,_)=location(&data,root,"main.ag").unwrap();std::fs::write(&file,"broken").unwrap();assert!(checkpoint(&data,root,"main.ag","safe","draft").is_err());assert_eq!(std::fs::read_to_string(file).unwrap(),"broken");}
 #[test]fn quota_handles_json_escaping_and_keeps_latest(){let t=tempfile::tempdir().unwrap();let data=t.path().join("data");let root=t.path().to_str().unwrap();for n in 0..8{checkpoint(&data,root,"main.ag",&format!("{}{}","\"".repeat(600_000),n),"edit").unwrap();}let(file,_,_)=location(&data,root,"main.ag").unwrap();assert!(std::fs::metadata(file).unwrap().len()<=MAX_STORE as u64);let entries=list(&data,root,"main.ag").unwrap();assert!(entries.len()<8);assert!(read(&data,root,"main.ag",&entries[0].id).unwrap().ends_with('7'));}
 #[cfg(windows)]#[test]fn linked_source_rejected(){let t=tempfile::tempdir().unwrap();let outside=tempfile::tempdir().unwrap();std::fs::write(outside.path().join("main.ag"),"private").unwrap();if std::os::windows::fs::symlink_dir(outside.path(),t.path().join("linked")).is_ok(){assert!(list(&t.path().join("data"),t.path().to_str().unwrap(),"linked/main.ag").is_err());}}
 #[cfg(unix)]#[test]fn linked_source_rejected(){let t=tempfile::tempdir().unwrap();std::os::unix::fs::symlink("/tmp",t.path().join("linked")).unwrap();assert!(list(&t.path().join("data"),t.path().to_str().unwrap(),"linked/main.ag").is_err());}
}



