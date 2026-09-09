#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

#[derive(Default)]
struct Operations { cancel: Mutex<Option<Arc<AtomicBool>>>, api: Mutex<HashMap<String,Arc<AtomicBool>>> }
fn err(e: impl std::fmt::Display)->String {e.to_string()}
fn resources(app:&tauri::AppHandle)->PathBuf {
    let packaged=normal_path(app.path().resource_dir().unwrap_or_default().join("resources")); if packaged.join("bin").is_dir(){return packaged;}
    let local=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources");
    if local.is_dir() {return local;}
    app.path().resource_dir().unwrap_or_default().join("resources")
}
fn data(app:&tauri::AppHandle)->Result<PathBuf,String> {let p=app.path().app_data_dir().map_err(err)?; std::fs::create_dir_all(&p).map_err(err)?; Ok(p)}
const EXAMPLES:[(&str,&str,&str);4]=[("tickets","tickets.ag","Tickets"),("spawns","spawns.ag","Spawns"),("stones","app.ag","Stones"),("icc","minter.ag","KCC20MintController")];
fn portable_projects_root(exe:&Path)->Result<PathBuf,String>{
    let parent=exe.parent().ok_or("Executable folder missing")?;
    // Both the root launcher and direct launch of the included release use one folder.
    if let Some(release)=parent.parent(){if release.file_name().and_then(|n|n.to_str())==Some("release"){if let Some(root)=release.parent(){if root.join("Start-Editor.cmd").is_file(){return Ok(root.join("projects"));}}}}
    Ok(parent.join("projects"))
}
fn projects(app:&tauri::AppHandle)->Result<PathBuf,String>{
    let root=if let Some(custom)=std::env::var_os("ARGENT_PROJECTS_DIR").filter(|v|!v.is_empty()){
        let path=PathBuf::from(custom);if !path.is_absolute(){return Err("Projects folder must be an absolute path".into());}path
    }else if cfg!(debug_assertions){PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../projects")}
    else if cfg!(target_os="macos"){app.path().document_dir().map_err(err)?.join("Argent Studio/projects")}
    else{portable_projects_root(&std::env::current_exe().map_err(err)?)?};
    write_allowed(&root)?;seed_examples(&resources(app).join("examples/catalog"),&root)?;Ok(normal_path(root))
}
fn copy_example(source:&Path,target:&Path)->Result<(),String>{
    if std::fs::symlink_metadata(source).map_err(err)?.file_type().is_symlink(){return Err("Linked example paths are unsupported".into());}
    std::fs::create_dir_all(target).map_err(err)?;
    for item in std::fs::read_dir(source).map_err(err)?{let item=item.map_err(err)?;let name=item.file_name();let name_text=name.to_string_lossy();if name_text.starts_with('.')||["build","target"].contains(&name_text.as_ref()){continue;}let kind=item.file_type().map_err(err)?;if kind.is_symlink(){return Err("Linked example paths are unsupported".into());}if kind.is_dir(){copy_example(&item.path(),&target.join(name))?;}else{let mut input=std::fs::File::open(item.path()).map_err(err)?;let mut output=std::fs::OpenOptions::new().write(true).create_new(true).open(target.join(name)).map_err(err)?;std::io::copy(&mut input,&mut output).map_err(err)?;}}
    Ok(())
}
fn seed_examples(catalog:&Path,root:&Path)->Result<(),String>{
    std::fs::create_dir_all(root).map_err(err)?;
    for(id,_,_)in EXAMPLES{let target=root.join(id);if target.exists(){continue;}
        let staging=tempfile::Builder::new().prefix(".example-").tempdir_in(root).map_err(err)?;copy_example(&catalog.join(id),staging.path())?;
        if let Err(e)=std::fs::rename(staging.path(),&target){if !target.exists(){return Err(err(e));}}
    }Ok(())
}
fn example_project(root:PathBuf,entry:&str,app_name:&str)->Value{json!({"root":root,"path":root,"entry":root.join(entry),"app":app_name})}
fn copy_project(source:&Path,target:&Path)->Result<(),String>{
    for item in std::fs::read_dir(source).map_err(err)? {
        let item=item.map_err(err)?;let name=item.file_name();let text=name.to_string_lossy();
        if ["build","target","node_modules",".git",".cache",".trash",".cargo",".codex",".agents"].contains(&text.as_ref()){continue;}
        let path=item.path();let kind=item.file_type().map_err(err)?;
        if kind.is_symlink() || !path.canonicalize().map_err(err)?.starts_with(source.canonicalize().map_err(err)?){return Err("Linked project paths are unsupported".into());}
        let destination=target.join(name);
        if kind.is_dir(){std::fs::create_dir(&destination).map_err(err)?;copy_project(&path,&destination)?;}
        else if kind.is_file(){let mut input=std::fs::File::open(path).map_err(err)?;let mut output=std::fs::OpenOptions::new().write(true).create_new(true).open(destination).map_err(err)?;std::io::copy(&mut input,&mut output).map_err(err)?;}
    }Ok(())
}
fn duplicate_into(source:&Path,projects_root:&Path,name:&str)->Result<PathBuf,String>{
    let name=name.trim();
    let reserved=name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()||name.len()>100||name.starts_with('.')||name.ends_with('.')||name.chars().any(|c|c.is_control()||"<>:\"/\\|?*".contains(c))||["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"].contains(&reserved.as_str()){return Err("Choose a valid project name without path separators".into());}
    let source=source.canonicalize().map_err(err)?;if !source.is_dir(){return Err("Project folder missing".into());}
    let target=projects_root.join(name);write_allowed(&target)?;
    let parent=projects_root.canonicalize().map_err(err)?;if parent.starts_with(&source){return Err("Cannot duplicate a project inside itself".into());}
    std::fs::create_dir(&target).map_err(err)?;
    copy_project(&source,&target).map_err(|e|format!("Project copy incomplete at {}: {e}",target.display()))?;Ok(normal_path(target))
}
fn archive_old_builds(root:&Path)->Result<Value,String>{
    let root=root.canonicalize().map_err(err)?;write_allowed(&root)?;let build=root.join("build");
    if !build.exists(){return Ok(json!({"moved":0,"kept":0,"archivePath":null}));}
    if std::fs::symlink_metadata(&build).map_err(err)?.file_type().is_symlink()||build.canonicalize().map_err(err)?!=build{return Err("Linked build paths are unsupported".into());}
    let mut builds=Vec::new();
    for item in std::fs::read_dir(&build).map_err(err)?{let item=item.map_err(err)?;let name=item.file_name().to_string_lossy().into_owned();let kind=item.file_type().map_err(err)?;
        if !kind.is_dir()||kind.is_symlink()||name.len()<13||!name.bytes().all(|c|c.is_ascii_digit()){continue;}
        if let Ok(timestamp)=name.parse::<u128>(){let path=item.path();if path.canonicalize().map_err(err)?!=path{return Err("Linked build paths are unsupported".into());}builds.push((timestamp,path));}
    }
    builds.sort_by(|a,b|b.0.cmp(&a.0));let kept=builds.len().min(5);
    if builds.len()<=5{return Ok(json!({"moved":0,"kept":kept,"archivePath":null}));}
    let trash=root.join(".trash");let archive=trash.join("builds");
    for path in [&trash,&archive]{if path.exists(){if std::fs::symlink_metadata(path).map_err(err)?.file_type().is_symlink()||path.canonicalize().map_err(err)?!=*path{return Err("Linked archive paths are unsupported".into());}}else{std::fs::create_dir(path).map_err(err)?;}}
    let batch=archive.join(SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_nanos().to_string());std::fs::create_dir(&batch).map_err(err)?;
    let mut moved=0;for(_,source)in builds.into_iter().skip(5){let target=batch.join(source.file_name().ok_or("Build folder name missing")?);std::fs::rename(&source,&target).map_err(|e|format!("Build cleanup stopped after {moved} moves; archive {}: {e}",batch.display()))?;moved+=1;}
    Ok(json!({"moved":moved,"kept":kept,"archivePath":normal_path(batch)}))
}
#[tauri::command] fn open_example(app:tauri::AppHandle,id:String)->Result<Value,String>{let(_,entry,name)=EXAMPLES.into_iter().find(|(key,_,_)|*key==id).ok_or("Unknown example")?;Ok(example_project(projects(&app)?.join(id),entry,name))}
#[tauri::command] fn duplicate_project(app:tauri::AppHandle,project_root:String,name:String)->Result<Value,String>{let root=duplicate_into(Path::new(&project_root),&projects(&app)?,&name)?;Ok(json!({"root":root,"path":root}))}
#[tauri::command] fn cleanup_builds(app:tauri::AppHandle,project_root:String)->Result<Value,String>{let operations=app.state::<Operations>();let active=operations.cancel.lock().map_err(err)?;if active.is_some(){return Err("An operation is already running".into());}archive_old_builds(Path::new(&project_root))}
fn executable(app:&tauri::AppHandle,name:&str)->Option<PathBuf> {
    let root=resources(app); let suffix=if cfg!(windows){".exe"}else{""};
    let filename=format!("{name}{suffix}");
    let mut paths=vec![root.join("bin").join(&filename),root.join("bin/runtime").join(&filename),root.join("toolchains/bin").join(&filename),root.join("toolchains/argent-master/target/release").join(&filename)];
    if let Some(path)=std::env::var_os("PATH") {paths.extend(std::env::split_paths(&path).map(|p|p.join(&filename)));}
    paths.into_iter().find(|p|p.is_file())
}
fn compiler_path(app:&tauri::AppHandle, custom:Option<String>)->Result<PathBuf,String> {
    let path=custom.filter(|s|!s.trim().is_empty()).or_else(||{let s=load_settings(app.clone()).ok()?;s.get("compiler").or_else(||s.get("compilerPath"))?.as_str().map(str::to_owned)});
    if let Some(p)=path {if Path::new(&p).is_file(){return Ok(p.into());}}
    executable(app,"argentc").ok_or("Argent compiler missing for this platform".into())
}
fn write_allowed(_path:&Path)->Result<(),String> { Ok(()) }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct FileEntry {name:String,path:String,is_directory:bool}
fn entries(path:&Path)->Result<Vec<FileEntry>,String>{
    let mut out=Vec::new(); for item in std::fs::read_dir(path).map_err(err)? {let item=item.map_err(err)?;let name=item.file_name().to_string_lossy().to_string();if ["node_modules","target",".git"].contains(&name.as_str()){continue;}out.push(FileEntry{name,path:item.path().to_string_lossy().to_string(),is_directory:item.file_type().map_err(err)?.is_dir()});}
    out.sort_by(|a,b|b.is_directory.cmp(&a.is_directory).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));Ok(out)
}
#[tauri::command] fn list_directory(path:String)->Result<Vec<FileEntry>,String>{entries(Path::new(&path))}
#[tauri::command] fn read_file(path:String)->Result<String,String>{std::fs::read_to_string(path).map_err(err)}
#[tauri::command] fn write_file(path:String,text:String)->Result<(),String>{let p=Path::new(&path);write_allowed(p)?;if let Some(parent)=p.parent(){std::fs::create_dir_all(parent).map_err(err)?;}atomic_write(p,text.as_bytes())}
#[tauri::command] fn create_directory(path:String)->Result<(),String>{write_allowed(Path::new(&path))?;if let Some(parent)=Path::new(&path).parent(){std::fs::create_dir_all(parent).map_err(err)?;}std::fs::create_dir(path).map_err(err)}
fn credential(kind:&str)->Result<keyring::Entry,String>{if !["api","admin"].contains(&kind){return Err("Unknown credential kind".into());}keyring::Entry::new("Argent Studio Tauri",kind).map_err(err)}
#[tauri::command] fn set_secret(kind:String,value:String)->Result<(),String>{let entry=credential(&kind)?;if value.trim().is_empty(){match entry.delete_credential(){Ok(_)|Err(keyring::Error::NoEntry)=>Ok(()),Err(e)=>Err(err(e))}}else{entry.set_password(value.trim()).map_err(err)}}
#[tauri::command] fn load_settings(app:tauri::AppHandle)->Result<Value,String>{
    let mut value=json!({"language":"de","model":"gpt-6-astra","reasoningEffort":"max","maxOutputTokens":32768,"maxRequests":8,"darkMode":false,"wordWrap":false,"aiHover":false,"aiEnabled":false});
    let p=data(&app)?.join("settings.json");if p.exists(){let saved:Value=serde_json::from_str(&std::fs::read_to_string(p).map_err(err)?).map_err(err)?;if let Some(map)=saved.as_object(){for(k,v)in map{value[k]=v.clone();}}}
    value["hasApiKey"]=json!(credential("api")?.get_password().is_ok());value["hasAdminKey"]=json!(credential("admin")?.get_password().is_ok());Ok(value)
}
#[tauri::command] fn save_settings(app:tauri::AppHandle,mut settings:Value)->Result<(),String>{
    if let Some(map)=settings.as_object_mut(){for key in ["apiKey","adminKey","protectedKey","protectedAdminKey","hasApiKey","hasAdminKey"]{map.remove(key);}}
    if let Some(n)=settings.get("maxOutputTokens").and_then(Value::as_u64){if !(1024..=128000).contains(&n){return Err("Invalid output limit".into());}}
    if let Some(n)=settings.get("maxRequests").and_then(Value::as_u64){if !(1..=8).contains(&n){return Err("Invalid request limit".into());}}
    atomic_write(&data(&app)?.join("settings.json"),&serde_json::to_vec_pretty(&settings).map_err(err)?)
}
#[tauri::command] fn app_info(app:tauri::AppHandle)->Result<Value,String>{let root=projects(&app)?;Ok(json!({"resources":resources(&app),"dataDir":data(&app)?,"projectsDir":root,"defaultProject":example_project(root.join("tickets"),"tickets.ag","Tickets"),"compiler":compiler_path(&app,None).ok(),"platform":std::env::consts::OS}))}
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct RunResult {exit_code:i32,stdout:String,stderr:String,output:String,success:bool,files:Vec<FileEntry>}
async fn process(app:&tauri::AppHandle,exe:PathBuf,args:Vec<String>,cwd:Option<PathBuf>,input:Option<Value>,limit:u64)->Result<RunResult,String>{
    let cancel=Arc::new(AtomicBool::new(false));{let state=app.state::<Operations>();let mut active=state.cancel.lock().map_err(err)?;if active.is_some(){return Err("An operation is already running".into());}*active=Some(cancel.clone());}
    let result=async {
        let mut cmd=tokio::process::Command::new(exe);cmd.args(args).env("NO_COLOR","1").stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);if let Some(p)=cwd{cmd.current_dir(p);}
        #[cfg(windows)] cmd.creation_flags(0x08000000);
        let mut child=cmd.spawn().map_err(err)?;
        if let Some(mut stdin)=child.stdin.take(){if let Some(value)=input{stdin.write_all(value.to_string().as_bytes()).await.map_err(err)?;}drop(stdin);}
        let stdout=child.stdout.take().ok_or("No stdout")?;let stderr=child.stderr.take().ok_or("No stderr")?;
        let a=app.clone(); let out_task=tauri::async_runtime::spawn(async move {let mut lines=BufReader::new(stdout).lines();let mut all=String::new();while let Ok(Some(line))=lines.next_line().await{let _=a.emit("process-output",json!({"stream":"stdout","line":line}));all.push_str(&line);all.push('\n');}all});
        let a=app.clone(); let err_task=tauri::async_runtime::spawn(async move {let mut reader=BufReader::new(stderr);let mut all=String::new();let _=reader.read_to_string(&mut all).await;for line in all.lines(){let _=a.emit("process-output",json!({"stream":"stderr","line":line}));}all});
        let start=std::time::Instant::now();let code=loop{if cancel.load(Ordering::Relaxed)||start.elapsed()>Duration::from_secs(limit){let _=child.kill().await;break -1;}if let Some(status)=child.try_wait().map_err(err)?{break status.code().unwrap_or(-1);}tokio::time::sleep(Duration::from_millis(40)).await;};
        Ok(RunResult{exit_code:code,stdout:out_task.await.map_err(err)?,stderr:err_task.await.map_err(err)?,output:String::new(),success:code==0,files:Vec::new()})
    }.await;
    *app.state::<Operations>().cancel.lock().map_err(err)?=None;result
}
#[tauri::command] fn cancel_operation(app:tauri::AppHandle)->Result<(),String>{if let Some(c)=app.state::<Operations>().cancel.lock().map_err(err)?.as_ref(){c.store(true,Ordering::Relaxed);}Ok(())}
#[tauri::command] async fn build(app:tauri::AppHandle,entry:String,project_root:String,app_name:Option<String>,compiler:Option<String>)->Result<RunResult,String>{
    let exe=compiler_path(&app,compiler)?;let output=Path::new(&project_root).join("build").join(format!("{}",SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_millis()));write_allowed(&output)?;std::fs::create_dir_all(&output).map_err(err)?;
    let mut args=vec!["build".into(),entry];if let Some(name)=app_name.filter(|s|!s.trim().is_empty()){args.extend(["--app".into(),name]);}args.extend(["--out".into(),output.to_string_lossy().into_owned()]);
    let mut result=process(&app,exe,args,Some(project_root.into()),None,300).await?;result.output=output.to_string_lossy().into_owned();result.success=result.success&&output.join("artifact.json").exists()&&output.join("manifest.json").exists();result.files=tree_files(&output)?;Ok(result)
}
#[tauri::command] async fn inspect(app:tauri::AppHandle,output:String,compiler:Option<String>)->Result<RunResult,String>{process(&app,compiler_path(&app,compiler)?,vec!["inspect".into(),output],None,None,120).await}
#[tauri::command] async fn language_request(app:tauri::AppHandle,mut request:Value)->Result<Value,String>{
    if request.get("standardLibrary").is_none(){request["standardLibrary"]=json!(resources(&app).join("toolchains/argent-master/std/core.ag"));}
    // Language requests are independent of compilation and may run while typing.
    let node=executable(&app,"node").ok_or("Node runtime is missing")?;let mut cmd=tokio::process::Command::new(node);cmd.arg(resources(&app).join("assets/language/studio-service.js")).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)] cmd.creation_flags(0x08000000);
    let mut child=cmd.spawn().map_err(err)?;let mut stdin=child.stdin.take().ok_or("No stdin")?;stdin.write_all(request.to_string().as_bytes()).await.map_err(err)?;drop(stdin);
    let out=tokio::time::timeout(Duration::from_secs(15),child.wait_with_output()).await.map_err(err)?.map_err(err)?;if !out.status.success(){return Err(String::from_utf8_lossy(&out.stderr).into_owned());}serde_json::from_slice(&out.stdout).map_err(err)
}
#[tauri::command] async fn run_scenario(app:tauri::AppHandle,artifact:String,scenario:Value)->Result<Value,String>{let exe=executable(&app,"ArgentTestRunner-v1").or_else(||executable(&app,"argent-test-runner")).ok_or("Test runtime missing for this platform")?;let result=process(&app,exe,vec![],None,Some(json!({"artifact":artifact,"scenario":scenario})),20).await?;if !result.success{return Err(format!("Test runner: {} {}",result.exit_code,result.stderr));}serde_json::from_str(&result.stdout).map_err(err)}
#[tauri::command] async fn api_request(app:tauri::AppHandle,route:String,method:String,body:Option<Value>,admin:Option<bool>,request_id:Option<String>,api_key:Option<String>)->Result<Value,String>{
    if !(route=="responses"||route.starts_with("models/")||route.starts_with("organization/costs?")||route=="organization/spend_limit"){return Err("Unsupported API route".into());}
    let key=match api_key.filter(|s|!s.trim().is_empty()){Some(key)=>key,None=>credential(if admin.unwrap_or(false){"admin"}else{"api"})?.get_password().map_err(|_|"Enter an API key in Settings first".to_string())?};
    let cancel=Arc::new(AtomicBool::new(false));let id=request_id.unwrap_or_else(||format!("{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));app.state::<Operations>().api.lock().map_err(err)?.insert(id.clone(),cancel.clone());
    let future=async{let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(900)).build().map_err(err)?;let method=match method.as_str(){"GET"=>reqwest::Method::GET,"POST"=>reqwest::Method::POST,_=>return Err("Unsupported HTTP method".into())};let mut req=client.request(method,format!("https://api.openai.com/v1/{route}")).bearer_auth(key);if let Some(body)=body{req=req.json(&body);}let response=req.send().await.map_err(err)?;let status=response.status();let value=response.json::<Value>().await.map_err(err)?;if !status.is_success(){return Err(format!("OpenAI HTTP {}: {}",status.as_u16(),value.pointer("/error/message").and_then(Value::as_str).unwrap_or("Request failed")));}Ok(value)};
    tokio::pin!(future);let result=loop{tokio::select!{result=&mut future=>break result,_=tokio::time::sleep(Duration::from_millis(100))=>{if cancel.load(Ordering::Relaxed){break Err("Request cancelled".into());}}}};app.state::<Operations>().api.lock().map_err(err)?.remove(&id);result
}
#[tauri::command] fn cancel_api(app:tauri::AppHandle,request_id:String)->Result<(),String>{if let Some(c)=app.state::<Operations>().api.lock().map_err(err)?.get(&request_id){c.store(true,Ordering::Relaxed);}Ok(())}
#[tauri::command] fn list_examples(app:tauri::AppHandle)->Result<Value,String>{Ok(json!([{"id":"tickets","title":"Tickets – Einstieg","entry":"tickets.ag","app":"Tickets","path":resources(&app).join("examples/catalog/tickets")},{"id":"spawns","title":"Spawns – Covenants erzeugen","entry":"spawns.ag","app":"Spawns","path":resources(&app).join("examples/catalog/spawns")},{"id":"stones","title":"Stones – mehrere Akteure","entry":"app.ag","app":"Stones","path":resources(&app).join("examples/catalog/stones")},{"id":"icc","title":"ICC – Kommunikation zwischen Apps","entry":"minter.ag","app":"KCC20MintController","path":resources(&app).join("examples/catalog/icc")}]))}
#[tauri::command] fn read_reference(app:tauri::AppHandle)->Result<String,String>{let root=resources(&app);for p in [root.join("README.md"),root.join("toolchains/argent-master/docs/language-reference.md")]{if p.exists(){return std::fs::read_to_string(p).map_err(err);}}Err("Reference document missing".into())}
#[tauri::command] fn toolchain_status(app:tauri::AppHandle)->Value{json!({"compiler":compiler_path(&app,None).ok(),"node":executable(&app,"node"),"testRunner":executable(&app,"ArgentTestRunner-v1").or_else(||executable(&app,"argent-test-runner")),"platform":std::env::consts::OS})}
#[tauri::command] async fn toolchain_verify(app:tauri::AppHandle)->Result<RunResult,String>{process(&app,compiler_path(&app,None)?,vec![],None,None,20).await}
#[tauri::command] fn open_external(url:String)->Result<(),String>{if url!="https://platform.openai.com/settings/organization/billing/overview" {return Err("Unsupported external URL".into());}
    #[cfg(windows)] {std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler",&url]).spawn().map_err(err)?;}
    #[cfg(target_os="macos")] {std::process::Command::new("open").arg(&url).spawn().map_err(err)?;}
    #[cfg(target_os="linux")] {std::process::Command::new("xdg-open").arg(&url).spawn().map_err(err)?;}
    Ok(())
}
fn main(){tauri::Builder::default().manage(Operations::default()).plugin(tauri_plugin_dialog::init()).on_page_load(|webview,payload| { if std::env::args().any(|a|a=="--ui-smoke") && matches!(payload.event(),tauri::webview::PageLoadEvent::Finished) { let _=webview.eval(UI_SMOKE_SCRIPT); } }).setup(|app| { if std::env::args().any(|a|a=="--ui-smoke") { let handle=app.handle().clone(); tauri::async_runtime::spawn(async move {tokio::time::sleep(Duration::from_secs(60)).await;let _=record_ui_smoke(handle,json!({"success":false,"error":"Native UI smoke exceeded 60 seconds; page/IPC initialization did not finish"}));}); } if std::env::args().any(|a|a=="--smoke-test") { if let Some(window)=app.get_webview_window("main"){let _=window.hide();} let handle=app.handle().clone(); tauri::async_runtime::spawn(async move {let result=native_smoke(handle.clone()).await;let ok=result.is_ok();let report=match result{Ok(v)=>v,Err(e)=>json!({"success":false,"error":e})};let args:Vec<String>=std::env::args().collect();let target=args.iter().position(|a|a=="--smoke-report").and_then(|i|args.get(i+1)).map(PathBuf::from).unwrap_or_else(||PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-output/native-smoke.json"));if write_allowed(&target).is_ok(){if let Some(parent)=target.parent(){let _=std::fs::create_dir_all(parent);}let _=std::fs::write(target,serde_json::to_vec_pretty(&report).unwrap_or_default());}handle.exit(if ok{0}else{1});}); } Ok(()) }).invoke_handler(tauri::generate_handler![app_info,list_directory,read_file,write_file,create_directory,load_settings,save_settings,set_secret,build,inspect,cancel_operation,language_request,run_scenario,run_scenario_json,api_request,cancel_api,list_examples,open_example,duplicate_project,cleanup_builds,clone_example,trash_file,create_file,read_reference,toolchain_status,toolchain_verify,toolchain_updates,open_external,record_ui_smoke]).run(tauri::generate_context!()).expect("Unable to start Argent Studio");}


#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn project_duplicate_preserves_sources_and_excludes_generated_files(){
        let sandbox=tempfile::tempdir().unwrap();let source=sandbox.path().join("source");let projects=sandbox.path().join("projects");std::fs::create_dir(&source).unwrap();std::fs::create_dir(&projects).unwrap();
        std::fs::write(source.join("tickets.ag"),"user changes").unwrap();std::fs::write(source.join(".gitignore"),"build/").unwrap();
        for folder in ["build","target","node_modules",".git",".trash",".cache"]{std::fs::create_dir(source.join(folder)).unwrap();std::fs::write(source.join(folder).join("private.txt"),"excluded").unwrap();}
        let target=duplicate_into(&source,&projects,"My Tickets").unwrap();assert_eq!(std::fs::read_to_string(target.join("tickets.ag")).unwrap(),"user changes");assert!(target.join(".gitignore").is_file());assert_eq!(std::fs::read_dir(&target).unwrap().count(),2);
        assert!(duplicate_into(&source,&projects,"My Tickets").is_err());assert!(duplicate_into(&source,&projects,"../escape").is_err());assert!(duplicate_into(&source,&projects,"CON").is_err());assert!(duplicate_into(&source,&source,"recursive").is_err());assert_eq!(std::fs::read_to_string(source.join("tickets.ag")).unwrap(),"user changes");
    }
    #[test] fn build_cleanup_keeps_latest_five_and_archives_without_deleting(){
        let sandbox=tempfile::tempdir().unwrap();let root=sandbox.path();let build=root.join("build");std::fs::create_dir(&build).unwrap();
        for i in 0..8{let path=build.join((1_700_000_000_000u64+i).to_string());std::fs::create_dir(&path).unwrap();std::fs::write(path.join("artifact.json"),format!("build {i}")).unwrap();}
        std::fs::create_dir(build.join("manual-output")).unwrap();std::fs::write(build.join("notes.txt"),"keep").unwrap();
        let result=archive_old_builds(root).unwrap();assert_eq!(result["moved"],3);assert_eq!(result["kept"],5);let archive=PathBuf::from(result["archivePath"].as_str().unwrap());
        for i in 0..8{let name=(1_700_000_000_000u64+i).to_string();let path=if i<3{archive.join(name)}else{build.join(name)};assert_eq!(std::fs::read_to_string(path.join("artifact.json")).unwrap(),format!("build {i}"));}
        assert!(build.join("manual-output").is_dir());assert!(build.join("notes.txt").is_file());assert_eq!(archive_old_builds(root).unwrap()["moved"],0);
    }
    #[test] fn seeded_examples_preserve_user_edits_and_deletions(){
        let sandbox=tempfile::tempdir().unwrap();let catalog=sandbox.path().join("catalog");let root=sandbox.path().join("projects");
        for(id,entry,_)in EXAMPLES{std::fs::create_dir_all(catalog.join(id)).unwrap();std::fs::write(catalog.join(id).join(entry),"original").unwrap();std::fs::write(catalog.join(id).join("notes.md"),"notes").unwrap();}
        seed_examples(&catalog,&root).unwrap();
        for(id,entry,_)in EXAMPLES{assert_eq!(std::fs::read_to_string(root.join(id).join(entry)).unwrap(),"original");}
        std::fs::write(root.join("tickets/tickets.ag"),"user edit").unwrap();std::fs::remove_file(root.join("tickets/notes.md")).unwrap();
        seed_examples(&catalog,&root).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("tickets/tickets.ag")).unwrap(),"user edit");assert!(!root.join("tickets/notes.md").exists());assert_eq!(std::fs::read_dir(&root).unwrap().count(),4);
    }
    #[test] fn failed_example_seed_does_not_publish_partial_project(){
        let sandbox=tempfile::tempdir().unwrap();let root=sandbox.path().join("projects");
        assert!(seed_examples(&sandbox.path().join("missing-catalog"),&root).is_err());assert!(!root.join("tickets").exists());assert_eq!(std::fs::read_dir(&root).unwrap().count(),0);
    }
    #[test] fn portable_release_and_root_launcher_share_projects(){
        let sandbox=tempfile::tempdir().unwrap();let root=sandbox.path();std::fs::write(root.join("Start-Editor.cmd"),"").unwrap();
        assert_eq!(portable_projects_root(&root.join("release/package/editor.exe")).unwrap(),root.join("projects"));
        assert_eq!(portable_projects_root(&root.join("standalone/editor.exe")).unwrap(),root.join("standalone/projects"));
    }

    #[test] fn real_compiler_builds_copied_example(){
        let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources");
        let exe=root.join(if cfg!(windows){"bin/argentc.exe"}else{"bin/argentc"});
        if !exe.exists(){return;}
        fn find_ag(path:&Path)->Option<PathBuf>{for entry in std::fs::read_dir(path).ok()?{let entry=entry.ok()?;let p=entry.path();if p.is_dir(){if let Some(found)=find_ag(&p){return Some(found);}}else if p.extension().and_then(|s|s.to_str())==Some("ag"){return Some(p);}}None}
        let entry=find_ag(&root.join("examples")).expect("Copied Argent example");
        let output=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-output/backend-build");
        std::fs::create_dir_all(&output).unwrap();
        let result=std::process::Command::new(exe).arg("build").arg(entry).arg("--out").arg(&output).output().unwrap();
        assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));
        assert!(output.join("artifact.json").exists());assert!(output.join("manifest.json").exists());
    }
    #[test] fn language_service_returns_structure(){
        use std::io::Write;
        let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources");
        let node=root.join(if cfg!(windows){"bin/runtime/node.exe"}else{"bin/runtime/node"});if !node.exists(){return;}
        let request=json!({"mode":"structure","path":root.join("examples/test.ag"),"text":"state Counter { count: int; }","position":0,"documents":[]});
        let mut child=std::process::Command::new(node).arg(root.join("assets/language/studio-service.js")).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(request.to_string().as_bytes()).unwrap();let out=child.wait_with_output().unwrap();assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));let value:Value=serde_json::from_slice(&out.stdout).unwrap();assert!(value.is_object());assert!(value.get("nodes").is_some()||value.get("sources").is_some(),"{value}");
    }
}


fn local_revision(root:&Path,name:&str)->String {
    if name=="Argent" {return std::fs::read_to_string(root.join("argent-head.json")).ok().and_then(|s|serde_json::from_str::<Value>(s.trim_start_matches('\u{feff}')).ok()).and_then(|v|v["sha"].as_str().map(str::to_owned)).unwrap_or_default();}
    let cargo=std::fs::read_to_string(root.join("toolchains/argent-master/Cargo.toml")).unwrap_or_default();let repo=if name=="SilverScript"{"kaspanet/silverscript"}else{"kaspanet/rusty-kaspa"};
    cargo.lines().find(|line|line.contains(repo)).and_then(|line|line.split("rev = \"").nth(1)).and_then(|v|v.split('"').next()).unwrap_or("").to_owned()
}
#[tauri::command] async fn toolchain_updates(app:tauri::AppHandle)->Result<Value,String>{
    let client=reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent("ArgentStudio-UpdateCheck/1.0").build().map_err(err)?;let mut out=Vec::new();
    for(name,repo)in [("Argent","argent-lang/argent"),("SilverScript","kaspanet/silverscript"),("Kaspa","kaspanet/rusty-kaspa")]{
        let pin=local_revision(&resources(&app),name);let result=async{let base=format!("https://api.github.com/repos/{repo}");let head=client.get(format!("{base}/commits/HEAD")).send().await.map_err(err)?.error_for_status().map_err(err)?.json::<Value>().await.map_err(err)?;let sha=head["sha"].as_str().ok_or("Missing GitHub revision")?;let status=if pin.is_empty(){"unknown".to_string()}else if pin==sha{"identical".to_string()}else{client.get(format!("{base}/compare/{pin}...{sha}")).send().await.map_err(err)?.error_for_status().map_err(err)?.json::<Value>().await.map_err(err)?["status"].as_str().unwrap_or("unknown").to_owned()};Ok::<Value,String>(json!({"name":name,"repo":repo,"localRevision":pin,"onlineRevision":sha,"status":status}))}.await;
        out.push(result.unwrap_or_else(|e|json!({"name":name,"repo":repo,"localRevision":pin,"status":"error","error":e})));
    }Ok(json!(out))
}


#[tauri::command] fn create_file(path:String,text:Option<String>)->Result<(),String>{use std::io::Write;let path=Path::new(&path);write_allowed(path)?;let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(err)?;file.write_all(text.unwrap_or_default().as_bytes()).map_err(err)}
#[tauri::command] fn trash_file(app:tauri::AppHandle,path:String,project_root:String)->Result<String,String>{
    let path=Path::new(&path).canonicalize().map_err(err)?;let root=Path::new(&project_root).canonicalize().map_err(err)?;write_allowed(&path)?;if !path.starts_with(&root)||path==root||!path.is_file(){return Err("Select a file within this project".into());}
    let trash=data(&app)?.join("trash");std::fs::create_dir_all(&trash).map_err(err)?;let target=trash.join(format!("{}-{}",SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_nanos(),path.file_name().unwrap_or_default().to_string_lossy()));std::fs::rename(&path,&target).map_err(err)?;Ok(target.to_string_lossy().into_owned())
}
#[tauri::command] fn clone_example(app:tauri::AppHandle,id:String)->Result<Value,String>{
    let(_,entry,app_name)=EXAMPLES.into_iter().find(|(key,_,_)|*key==id).ok_or("Unknown example")?;
    let source=resources(&app).join("examples/catalog").join(&id);let target=projects(&app)?.join(format!("{}-{}",id,SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_nanos()));
    std::fs::create_dir(&target).map_err(err)?;copy_example(&source,&target)?;Ok(example_project(target,entry,app_name))
}

fn atomic_write(path:&Path,bytes:&[u8])->Result<(),String>{use std::io::Write;let parent=path.parent().ok_or("File parent missing")?;let mut temp=tempfile::NamedTempFile::new_in(parent).map_err(err)?;temp.write_all(bytes).map_err(err)?;temp.as_file_mut().sync_all().map_err(err)?;temp.persist(path).map_err(err)?;Ok(())}




fn tree_files(path:&Path)->Result<Vec<FileEntry>,String>{let mut all=Vec::new();for item in entries(path)?{if item.is_directory{all.extend(tree_files(Path::new(&item.path))?);}else{all.push(item);}}Ok(all)}
async fn native_smoke(app:tauri::AppHandle)->Result<Value,String>{
    let info=app_info(app.clone())?;let example=clone_example(app.clone(),"tickets".into())?;
    let root=example["root"].as_str().ok_or("No example root")?.to_string();let entry=example["entry"].as_str().ok_or("No example entry")?.to_string();
    let text=read_file(entry.clone())?;write_file(entry.clone(),text.clone())?;
    let directory=list_directory(root.clone())?;if directory.is_empty(){return Err("Example project empty".into());}
    let model=language_request(app.clone(),json!({"mode":"structure","path":entry,"text":text,"documents":[],"position":0})).await?;
    let result=build(app.clone(),entry.clone(),root.clone(),Some("Tickets".into()),None).await?;if !result.success{return Err(format!("Build failed: {} {}",result.stdout,result.stderr));}
    let inspection=inspect(app.clone(),result.output.clone(),None).await?;if !inspection.success{return Err(format!("Inspect failed: {}",inspection.stderr));}
    let runtime=run_scenario(app.clone(),format!("{}/artifact.json",result.output),json!({})).await?;
    let new_path=Path::new(&root).join("smoke-create.ag").to_string_lossy().into_owned();create_file(new_path.clone(),Some("// native smoke".into()))?;if create_file(new_path.clone(),None).is_ok(){return Err("Exclusive create overwrote existing file".into());}let trash=trash_file(app.clone(),new_path.clone(),root.clone())?;if Path::new(&new_path).exists()||!Path::new(&trash).exists(){return Err("Reversible file removal failed".into());}
    Ok(json!({"success":true,"app":info,"project":root,"build":result,"inspectExitCode":inspection.exit_code,"structurePresent":model.is_object(),"runtimeInvalidScenarioResult":runtime,"exclusiveCreate":true,"reversibleRemoval":true}))
}

fn normal_path(path:PathBuf)->PathBuf {
    #[cfg(windows)] {let text=path.to_string_lossy();if let Some(rest)=text.strip_prefix(r"\\?\UNC\"){return PathBuf::from(format!(r"\\{}",rest));}if let Some(rest)=text.strip_prefix(r"\\?\"){return PathBuf::from(rest);}}
    path
}

#[tauri::command] async fn run_scenario_json(app:tauri::AppHandle,artifact:String,scenario_json:String)->Result<Value,String>{
    if scenario_json.len()>4_000_000{return Err("Scenario exceeds 4 MB".into());}
    let scenario:Value=serde_json::from_str(&scenario_json).map_err(err)?;
    run_scenario(app,artifact,scenario).await
}


#[tauri::command] fn record_ui_smoke(app:tauri::AppHandle,report:Value)->Result<(),String>{
    if !std::env::args().any(|a|a=="--ui-smoke"){return Err("UI smoke reporting disabled in normal application mode".into());}
    let args:Vec<String>=std::env::args().collect();let target=args.iter().position(|a|a=="--ui-smoke-report").and_then(|i|args.get(i+1)).map(PathBuf::from).unwrap_or_else(||PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-output/native-ui-smoke.json"));
    write_allowed(&target)?;if let Some(parent)=target.parent(){std::fs::create_dir_all(parent).map_err(err)?;}atomic_write(&target,&serde_json::to_vec_pretty(&report).map_err(err)?)?;app.exit(if report["success"]==true{0}else{1});Ok(())
}
const UI_SMOKE_SCRIPT:&str=r#"
(async()=>{
 if(window.__ARGENT_UI_SMOKE_STARTED)return;window.__ARGENT_UI_SMOKE_STARTED=true;
 const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 const invoke=(name,args)=>window.__TAURI_INTERNALS__.invoke(name,args);
 const wait=async(test,label)=>{const start=Date.now();while(Date.now()-start<25000){if(test())return;await new Promise(r=>setTimeout(r,100));}throw Error(label+'; status='+document.querySelector('#status')?.textContent);};
 try{
  await wait(()=>window.__ARGENT_APP__?.state?.current,'Frontend did not initialize an editable document');
  const app=window.__ARGENT_APP__;if(!document.querySelector('.cm-editor'))throw Error('CodeMirror editor missing');
  const current=app.state.current;if(!current.text?.length)throw Error('Initial example source is empty');
  const result=await app.context.build();if(!result?.success)throw Error('Actual UI-to-Rust build failed: '+JSON.stringify(result));
  app.setView('structure');await wait(()=>document.querySelectorAll('.structure-card').length>0,'Structure cards did not render');
  const report={success:true,url:location.href,document:current.path,editorPresent:true,buildSuccess:result.success,buildOutput:result.output,artifactFiles:result.files.length,structureCards:document.querySelectorAll('.structure-card').length,status:document.querySelector('#status')?.textContent,errors};
  if(errors.length)throw Error(errors.join('; '));await invoke('record_ui_smoke',{report});
 }catch(error){await invoke('record_ui_smoke',{report:{success:false,error:String(error.stack||error),url:location.href,status:document.querySelector('#status')?.textContent,errors}});}
})();
"#;
