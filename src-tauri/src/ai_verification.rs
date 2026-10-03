//! Compile and test immutable assistant snapshots, never the user's project.
use std::{collections::HashSet, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
use serde::Deserialize;
use serde_json::{json, Value, value::RawValue};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use super::{err, resources, Operations};

#[derive(Deserialize)]
pub struct ProposalSource { path: String, content: String }
const OUTPUT_LIMIT: usize = 64_000;
fn source_path(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.len()>240 || !path.ends_with(".ag") || path.contains('\\') || path.contains(':') || path.starts_with('/') { return Err("Snapshot requires relative .ag paths".into()); }
    for part in path.split('/') {
        let stem=part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty() || part.starts_with('.') || part.ends_with('.') || part.ends_with(' ') || part.chars().any(|c|c.is_control() || "<>\"|?*".contains(c)) || ["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"].contains(&stem.as_str()) { return Err("Unsafe snapshot path".into()); }
    }
    Ok(PathBuf::from(path))
}
// Tokenize enough to recognize imports outside strings/comments. Escaped import paths
// are deliberately refused, so compiler decoding cannot conceal a filesystem escape.
fn import_paths(text: &str) -> Result<Vec<String>, String> {
    let bytes=text.as_bytes(); let mut i=0; let mut importing=false; let mut out=Vec::new();
    while i<bytes.len() {
        if bytes[i..].starts_with(b"//") { while i<bytes.len()&&bytes[i]!=b'\n' {i+=1;} continue; }
        if bytes[i..].starts_with(b"/*") { i+=2; let mut depth=1; while i<bytes.len()&&depth>0 {if bytes[i..].starts_with(b"/*"){depth+=1;i+=2;}else if bytes[i..].starts_with(b"*/"){depth-=1;i+=2;}else{i+=1;}} continue; }
        if bytes[i]==b'"' {i+=1;let start=i;let mut escaped=false;while i<bytes.len() {if bytes[i]==b'\\'{escaped=true;i=(i+2).min(bytes.len());}else if bytes[i]==b'"'{break;}else{i+=1;}}if importing {if escaped||i==bytes.len(){return Err("Unsupported escaped import path".into());}out.push(text[start..i].into());}i=(i+1).min(bytes.len());continue;}
        if bytes[i]==b';' {importing=false;i+=1;continue;}
        if bytes[i].is_ascii_alphabetic()||bytes[i]==b'_' {let start=i;i+=1;while i<bytes.len()&&(bytes[i].is_ascii_alphanumeric()||bytes[i]==b'_'){i+=1;}if &text[start..i]=="import"{importing=true;}continue;}
        i+=1;
    }
    Ok(out)
}
fn prepare(sources: &[ProposalSource], entry: &str, root: &Path) -> Result<PathBuf,String> {
    if sources.is_empty()||sources.len()>128 {return Err("Snapshot requires 1 to 128 sources".into());}
    let entry=source_path(entry)?;let mut names=HashSet::new();let mut total=0;
    for source in sources {let _=source_path(&source.path)?;total+=source.content.len();if source.content.len()>160_000||total>2_000_000{return Err("Snapshot source size limit exceeded".into());}if !names.insert(source.path.to_lowercase()){return Err("Duplicate snapshot path".into());}}
    if !names.contains(&entry.to_string_lossy().to_lowercase()){return Err("Snapshot entry source missing".into());}
    for source in sources {let parent=Path::new(&source.path).parent().unwrap_or(Path::new(""));for imported in import_paths(&source.content)? {if imported=="std::core"{continue;}let imported=imported.strip_prefix("./").unwrap_or(&imported);let relative=source_path(imported)?;let target=parent.join(relative).to_string_lossy().replace('\\',"/").to_lowercase();if !names.contains(&target){return Err(format!("Snapshot import is missing: {imported}"));}}}
    std::fs::create_dir(root).map_err(err)?;
    for source in sources {let path=root.join(source_path(&source.path)?);std::fs::create_dir_all(path.parent().ok_or("Snapshot parent missing")?).map_err(err)?;use std::io::Write;std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(err)?.write_all(source.content.as_bytes()).map_err(err)?;}
    Ok(root.join(entry))
}
struct VerificationScenario { scenario:Box<RawValue>, expected_status:String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct ScenarioEnvelope { scenario:Box<RawValue>, expected_status:Option<String> }
fn scenarios(raw: Option<String>) -> Result<Vec<VerificationScenario>,String> {
    let raw=raw.unwrap_or_else(||"[]".into());if raw.len()>4_000_000{return Err("Scenario size limit exceeded".into());}
    let values:Vec<Box<RawValue>>=serde_json::from_str(&raw).map_err(err)?;if values.len()>8{return Err("At most 8 verification scenarios are allowed".into());}
    let mut scenarios=Vec::new();
    for value in values {
        let parsed:Value=serde_json::from_str(value.get()).map_err(err)?;
        if !parsed.is_object(){return Err("Scenarios must be JSON objects".into());}
        let scenario=if parsed.get("scenario").is_some(){let envelope:ScenarioEnvelope=serde_json::from_str(value.get()).map_err(err)?;VerificationScenario{scenario:envelope.scenario,expected_status:envelope.expected_status.unwrap_or_else(||"passed".into())}}else{VerificationScenario{scenario:value,expected_status:"passed".into()}};
        if !["passed","failed"].contains(&scenario.expected_status.as_str()){return Err("Expected scenario status must be passed or failed".into());}
        let parsed:Value=serde_json::from_str(scenario.scenario.get()).map_err(err)?;
        if !parsed.is_object(){return Err("Scenarios must be JSON objects".into());}
        if parsed.get("artifacts").is_some_and(|v| !v.is_null() && !v.as_array().is_some_and(|a|a.is_empty())) {return Err("Verification scenarios cannot load external artifacts".into());}
        scenarios.push(scenario);
    }
    Ok(scenarios)
}
fn bundled(root:&Path,name:&str)->Result<PathBuf,String>{let file=format!("{name}{}",if cfg!(windows){".exe"}else{""});let path=root.join("bin").join(file);if !path.is_file(){return Err(format!("Bundled {name} is missing for this platform"));}Ok(path)}
async fn drain(mut reader:impl tokio::io::AsyncRead+Unpin)->Result<String,String>{let mut output=Vec::new();let mut buffer=[0u8;8192];loop{let n=reader.read(&mut buffer).await.map_err(err)?;if n==0{break;}let keep=n.min(OUTPUT_LIMIT.saturating_sub(output.len()));output.extend_from_slice(&buffer[..keep]);}Ok(String::from_utf8_lossy(&output).into_owned())}
async fn run(exe:&Path,args:&[String],cwd:&Path,input:Option<String>,cancel:&AtomicBool,seconds:u64)->Result<Value,String>{
    if cancel.load(Ordering::Relaxed){return Err("Verification cancelled".into());}
    let mut command=tokio::process::Command::new(exe);command.args(args).current_dir(cwd).env("NO_COLOR","1").stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x08000000);
    let mut child=command.spawn().map_err(err)?;let stdout=child.stdout.take().ok_or("No stdout")?;let stderr=child.stderr.take().ok_or("No stderr")?;
    let out=tokio::spawn(drain(stdout));let error=tokio::spawn(drain(stderr));let mut stdin=child.stdin.take().ok_or("No stdin")?;
    let writer=tokio::spawn(async move {if let Some(input)=input{stdin.write_all(input.as_bytes()).await.map_err(err)?;}drop(stdin);Ok::<(),String>(())});
    let start=std::time::Instant::now();let (code,stopped)=loop{if cancel.load(Ordering::Relaxed)||start.elapsed()>Duration::from_secs(seconds){let _=child.kill().await;break(-1,true);}if let Some(status)=child.try_wait().map_err(err)?{break(status.code().unwrap_or(-1),false);}tokio::time::sleep(Duration::from_millis(40)).await;};
    let stdout=out.await.map_err(err)??;let stderr=error.await.map_err(err)??;let written=writer.await.map_err(err)?;if !stopped{written?;}Ok(json!({"success":code==0,"exitCode":code,"stdout":stdout,"stderr":stderr,"cancelled":stopped}))
}
fn redact(value:Value,root:&Path)->Value {match value {Value::String(s)=>{let native=root.to_string_lossy();Value::String(s.replace(native.as_ref(),"<verification>").replace(&native.replace('\\',"/"),"<verification>"))},Value::Array(v)=>Value::Array(v.into_iter().map(|v|redact(v,root)).collect()),Value::Object(v)=>Value::Object(v.into_iter().map(|(k,v)|(k,redact(v,root))).collect()),other=>other}}
async fn verify(root:&Path,sources:Vec<ProposalSource>,entry:String,app_name:String,scenarios:Vec<VerificationScenario>,cancel:&AtomicBool)->Result<Value,String>{
    if app_name.len()>100||!app_name.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'){return Err("Invalid verification app name".into());}
    let compiler=bundled(root,"argentc")?;let runner=if scenarios.is_empty(){None}else{Some(bundled(root,"ArgentTestRunner-v1")?)};
    let temporary=tempfile::Builder::new().prefix("argent-ai-verify-").tempdir().map_err(err)?;let source_root=temporary.path().join("sources");let entry=prepare(&sources,&entry,&source_root)?;let build=temporary.path().join("build");
    let mut args=vec!["build".into(),entry.to_string_lossy().into_owned()];if !app_name.is_empty(){args.extend(["--app".into(),app_name]);}args.extend(["--out".into(),build.to_string_lossy().into_owned()]);let compile=run(&compiler,&args,&source_root,None,cancel,120).await?;
    let artifact=build.join("artifact.json");let compiled=compile["success"]==true&&artifact.is_file()&&build.join("manifest.json").is_file();let mut compile=compile;compile["success"]=json!(compiled);let mut tests=Vec::new();
    if compiled {for scenario in scenarios {if cancel.load(Ordering::Relaxed){tests.push(json!({"status":"cancelled"}));break;}
        let input=format!("{{\"artifact\":{},\"scenario\":{}}}",serde_json::to_string(&artifact).map_err(err)?,scenario.scenario.get());let result=run(runner.as_ref().ok_or("Runner missing")?,&[],&source_root,Some(input),cancel,20).await?;
        let result=if result["success"]==true{serde_json::from_str::<Value>(result["stdout"].as_str().unwrap_or("")).unwrap_or_else(|_|json!({"status":"error","message":"Invalid VM output"}))}else{json!({"status":if result["cancelled"]==true{"cancelled"}else{"error"},"exitCode":result["exitCode"],"message":result["stderr"]})};let mut result=result;result["expectedStatus"]=json!(scenario.expected_status);result["success"]=json!(result["status"]==result["expectedStatus"]);tests.push(result);
    }}
    let success=compiled&&!cancel.load(Ordering::Relaxed)&&tests.iter().all(|v|v["success"]==true);Ok(redact(json!({"success":success,"compile":compile,"tests":tests}),temporary.path()))
}
struct OperationGuard<'a> { operations:&'a Operations, cancel:Arc<AtomicBool> }
impl Drop for OperationGuard<'_> {fn drop(&mut self){if let Ok(mut active)=self.operations.cancel.lock(){if active.as_ref().is_some_and(|c|Arc::ptr_eq(c,&self.cancel)){*active=None;}}}}
#[tauri::command]
pub async fn verify_ai_proposal(app:tauri::AppHandle,sources:Vec<ProposalSource>,entry:String,app_name:String,scenarios_json:Option<String>)->Result<Value,String>{
    let scenarios=scenarios(scenarios_json)?;let operations=app.state::<Operations>();let cancel=Arc::new(AtomicBool::new(false));{let mut active=operations.cancel.lock().map_err(err)?;if active.is_some(){return Err("An operation is already running".into());}*active=Some(cancel.clone());}
    let _guard=OperationGuard{operations:&operations,cancel:cancel.clone()};verify(&resources(&app),sources,entry,app_name,scenarios,&cancel).await
}

#[cfg(test)] mod tests {
    use super::*;
    fn source(path:&str,content:&str)->ProposalSource{ProposalSource{path:path.into(),content:content.into()}}
    #[test] fn rejects_escape_paths_and_case_collisions(){for path in ["../x.ag","/tmp/x.ag","C:/x.ag","x\\y.ag","x//y.ag","x/./y.ag","CON.ag"]{assert!(source_path(path).is_err(),"{path}");}let t=tempfile::tempdir().unwrap();assert!(prepare(&[source("x.ag",""),source("X.ag","")],"x.ag",&t.path().join("sources")).is_err());}
    #[test] fn rejects_import_escapes_and_missing_sources(){for import in ["../secret.ag","/tmp/secret.ag","C:/secret.ag","x\\secret.ag","missing.ag"]{let t=tempfile::tempdir().unwrap();assert!(prepare(&[source("main.ag",&format!("import \"{import}\";"))],"main.ag",&t.path().join("sources")).is_err());}}
    #[test] fn normal_imports_and_comments_are_supported(){let t=tempfile::tempdir().unwrap();let entry=prepare(&[source("main.ag","// import \"/secret\";\nimport \"./lib/x.ag\"; import \"std::core\";"),source("lib/x.ag","/* import \"../escape\"; */")],"main.ag",&t.path().join("sources")).unwrap();assert!(entry.exists());}
    #[test] fn preserves_large_integer_scenarios_and_bounds(){let values=scenarios(Some("[{\"value\":9223372036854775807}]".into())).unwrap();assert!(values[0].scenario.get().contains("9223372036854775807"));assert!(scenarios(Some(format!("[{}]",vec!["{}";9].join(",")))).is_err());assert!(scenarios(Some("[1]".into())).is_err());assert!(scenarios(Some(r#"[{"scenario":{},"expectedStatus":"unknown"}]"#.into())).is_err());let nested=scenarios(Some(r#"[{"scenario":{"value":9223372036854775807},"expectedStatus":"failed"}]"#.into())).unwrap();assert!(nested[0].scenario.get().contains("9223372036854775807"));}
    #[test] fn rejects_oversized_source(){let t=tempfile::tempdir().unwrap();assert!(prepare(&[source("main.ag",&"x".repeat(160_001))],"main.ag",&t.path().join("sources")).is_err());}
    #[tokio::test] async fn real_compiler_isolates_snapshot_and_reports_errors(){let resources=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources");if bundled(&resources,"argentc").is_err(){return;}let path=resources.join("examples/catalog/tickets/tickets.ag");let original=std::fs::read_to_string(&path).unwrap();let cancel=AtomicBool::new(false);let result=verify(&resources,vec![source("tickets.ag",&original)],"tickets.ag".into(),"".into(),vec![],&cancel).await.unwrap();assert_eq!(result["success"],true,"{result}");assert_eq!(std::fs::read_to_string(path).unwrap(),original);assert!(!result.to_string().contains("argent-ai-verify-"));let result=verify(&resources,vec![source("tickets.ag","not valid Argent !!!")],"tickets.ag".into(),"Tickets".into(),vec![],&cancel).await.unwrap();assert_eq!(result["success"],false);}
    #[tokio::test] async fn real_vm_distinguishes_passing_and_failing_scenarios(){
        let resources=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources");if bundled(&resources,"argentc").is_err()||bundled(&resources,"ArgentTestRunner-v1").is_err(){return;}
        let text=std::fs::read_to_string(resources.join("examples/catalog/tickets/tickets.ag")).unwrap();
        let scenario=r#"{"version":1,"inputs":[{"actor":"Ticket","entry":"redeem","state":{"owner":"@test-hash:1","serial":0,"redeemed":0},"args":["@test-key:1","@test-key:1"],"value":100000,"sequence":0}],"outputs":[{"actor":"Ticket","state":{"owner":"@test-hash:1","serial":0,"redeemed":1},"value":100000,"authorizing_input":0}],"funding":0,"lock_time":0,"artifacts":[]}"#;
        let cancel=AtomicBool::new(false);let passing=scenarios(Some(format!("[{scenario}]"))).unwrap();
        let result=verify(&resources,vec![source("tickets.ag",&text)],"tickets.ag".into(),"Tickets".into(),passing,&cancel).await.unwrap();assert_eq!(result["success"],true,"{result}");assert_eq!(result["tests"][0]["status"],"passed");
        let failing=scenarios(Some(format!("[{}]",scenario.replace("\"redeemed\":1","\"redeemed\":0")))).unwrap();
        let result=verify(&resources,vec![source("tickets.ag",&text)],"tickets.ag".into(),"Tickets".into(),failing,&cancel).await.unwrap();assert_eq!(result["compile"]["success"],true);assert_eq!(result["success"],false,"{result}");assert_eq!(result["tests"][0]["status"],"failed");assert_eq!(result["tests"][0]["success"],false);
        let failed_scenario=scenario.replace("\"redeemed\":1","\"redeemed\":0");let negative=scenarios(Some(format!("[{{\"scenario\":{failed_scenario},\"expectedStatus\":\"failed\"}}]"))).unwrap();
        let result=verify(&resources,vec![source("tickets.ag",&text)],"tickets.ag".into(),"Tickets".into(),negative,&cancel).await.unwrap();assert_eq!(result["success"],true,"{result}");assert_eq!(result["tests"][0]["status"],"failed");assert_eq!(result["tests"][0]["expectedStatus"],"failed");assert_eq!(result["tests"][0]["success"],true);
        let wrong=scenarios(Some(format!("[{{\"scenario\":{scenario},\"expectedStatus\":\"failed\"}}]"))).unwrap();
        let result=verify(&resources,vec![source("tickets.ag",&text)],"tickets.ag".into(),"Tickets".into(),wrong,&cancel).await.unwrap();assert_eq!(result["success"],false,"{result}");assert_eq!(result["tests"][0]["status"],"passed");assert_eq!(result["tests"][0]["success"],false);
    }
    #[tokio::test] async fn cancellation_prevents_process_start(){let cancelled=AtomicBool::new(true);assert!(run(Path::new("never-run"),&[],Path::new("."),None,&cancelled,1).await.is_err());}
}
