use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use serde_json::json;
use std::time::Duration;

// Explicit diagnostic mode: verifies the published updater feed and signatures,
// never calls install and never changes the running application.
pub fn start(app:&AppHandle){
 let handle=app.clone();
 tauri::async_runtime::spawn(async move{
  let result:Result<serde_json::Value,String>=async{
   let updater=handle.updater_builder().timeout(Duration::from_secs(45)).version_comparator(|_,_|true).build().map_err(|e|e.to_string())?;
   let mut update=updater.check().await.map_err(|e|e.to_string())?.ok_or("Update manifest missing")?;
   let bytes=update.download(|_,_|{},||{}).await.map_err(|e|e.to_string())?;
   // Corrupt a signature character while retaining an encoded signature token.
   #[cfg(feature="ci-update-test")]
   let original_signature=update.signature.clone();
   let mut signature=update.signature.as_bytes().to_vec();
   if signature.len()<32{return Err("Update signature too short".into());}
   let index=signature.len()/2;signature[index]=if signature[index]==b'A'{b'B'}else{b'A'};
   update.signature=String::from_utf8(signature).map_err(|e|e.to_string())?;
   if update.download(|_,_|{},||{}).await.is_ok(){return Err("Invalid update signature accepted".into());}
   #[allow(unused_mut)]
   let mut installed=false;
   #[cfg(feature="ci-update-test")]
   if std::env::args().any(|a|a=="--ci-install-update"){update.signature=original_signature;update.install(&bytes).map_err(|e|e.to_string())?;installed=true;}
   Ok(json!({"success":true,"version":update.version,"bytes":bytes.len(),"signatureVerified":true,"tamperedSignatureRejected":true,"installed":installed}))
  }.await;
  let ok=result.is_ok();let report=result.unwrap_or_else(|error|json!({"success":false,"error":error}));
  let args:Vec<String>=std::env::args().collect();let path=args.iter().position(|a|a=="--verify-update-report").and_then(|i|args.get(i+1)).map(std::path::PathBuf::from).unwrap_or_else(||std::env::temp_dir().join("argent-studio-update-verification.json"));
  if let Some(parent)=path.parent(){let _=std::fs::create_dir_all(parent);}let _=std::fs::write(path,serde_json::to_vec_pretty(&report).unwrap_or_default());
  handle.exit(if ok{0}else{1});
 });
}
