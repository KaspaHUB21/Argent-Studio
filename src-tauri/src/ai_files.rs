use std::{fs::File, io::Read, path::{Component, Path, PathBuf}};

fn components(path: &Path) -> Result<Vec<std::ffi::OsString>, String> {
    let mut parts = Vec::new();
    for part in path.components() {
        match part { Component::Normal(s) if !s.to_string_lossy().contains(':') && !s.to_string_lossy().starts_with('.') && !s.to_string_lossy().ends_with(['.', ' ']) => parts.push(s.to_owned()), _ => return Err("Project-relative file path required".into()) }
    }
    if parts.is_empty() { return Err("Project-relative file path required".into()); }
    Ok(parts)
}

#[cfg(windows)]
fn open_scoped(root: &Path, relative: &Path, missing: bool) -> Result<Option<File>, String> {
    open_scoped_with(root, relative, missing, |_| {})
}

#[cfg(windows)]
fn open_scoped_with(root: &Path, relative: &Path, missing: bool, after_root_open: impl FnOnce(&Path)) -> Result<Option<File>, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    if !root.is_absolute() { return Err("Absolute project root required".into()); }
    let parts = components(relative)?;
    let mut path = PathBuf::new();
    let mut guards = Vec::new();
    // Keep ancestors open without FILE_SHARE_WRITE or FILE_SHARE_DELETE. This prevents renames/link swaps
    // until the final file has been opened and checked through its own handle.
    for part in root.components() {
        path.push(part.as_os_str());
        if matches!(part, Component::Prefix(_)) { continue; }
        if matches!(part, Component::ParentDir | Component::CurDir) { return Err("Unnormalized project root".into()); }
        let handle = std::fs::OpenOptions::new().read(true).share_mode(1).custom_flags(0x00200000 | 0x02000000).open(&path).map_err(|e| e.to_string())?;
        let meta=handle.metadata().map_err(|e|e.to_string())?;
        if meta.file_attributes() & 0x400 != 0 || !meta.is_dir() { return Err("Linked project paths are unsupported for AI access".into()); }
        guards.push(handle);
    }
    after_root_open(root);
    for (index,part) in parts.iter().enumerate() {
        path.push(part);
        let last=index+1==parts.len();
        let file=match std::fs::OpenOptions::new().read(true).share_mode(1).custom_flags(0x00200000 | 0x02000000).open(&path) {
            Ok(file)=>file,
            Err(e) if last && missing && e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),
            Err(e)=>return Err(e.to_string())
        };
        let meta=file.metadata().map_err(|e|e.to_string())?;
        if meta.file_attributes() & 0x400 != 0 { return Err("Linked project paths are unsupported for AI access".into()); }
        if last { if !meta.is_file(){return Err("AI access requires a regular file".into());} return Ok(Some(file)); }
        if !meta.is_dir(){return Err("AI access requires a directory".into());}
        guards.push(file);
    }
    unreachable!()
}

// Resolve only Apple's fixed system aliases. Project-controlled links remain forbidden.
#[cfg(target_os="macos")]
fn macos_system_root(root: &Path) -> Result<PathBuf, String> {
    for (alias, target) in [("/var", "/private/var"), ("/tmp", "/private/tmp"), ("/etc", "/private/etc")] {
        if let Ok(rest) = root.strip_prefix(alias) {
            if std::fs::read_link(alias).map_err(|e| e.to_string())? != Path::new(target) {
                return Err("Unexpected macOS system alias".into());
            }
            return Ok(Path::new(target).join(rest));
        }
    }
    Ok(root.to_owned())
}

#[cfg(unix)]
fn open_scoped(root: &Path, relative: &Path, missing: bool) -> Result<Option<File>, String> {
    use std::{ffi::CString, os::{fd::{AsRawFd, FromRawFd}, unix::ffi::OsStrExt}};
    if !root.is_absolute(){return Err("Absolute project root required".into());}
    #[cfg(target_os="macos")]
    let normalized_root = macos_system_root(root)?;
    #[cfg(target_os="macos")]
    let root = normalized_root.as_path();
    let parts=components(relative)?;
    let mut directory=File::open("/").map_err(|e|e.to_string())?;
    let root_parts:Vec<_>=root.components().filter(|p| !matches!(p,Component::RootDir)).collect();
    for part in root_parts {
        let Component::Normal(name)=part else{return Err("Unnormalized project root".into())};
        let name=CString::new(name.as_bytes()).map_err(|e|e.to_string())?;
        let fd=unsafe{libc::openat(directory.as_raw_fd(),name.as_ptr(),libc::O_RDONLY|libc::O_DIRECTORY|libc::O_NOFOLLOW|libc::O_CLOEXEC)};
        if fd<0{return Err(std::io::Error::last_os_error().to_string());}
        directory=unsafe{File::from_raw_fd(fd)};
    }
    for (index,part) in parts.iter().enumerate(){
        let last=index+1==parts.len();let name=CString::new(part.as_bytes()).map_err(|e|e.to_string())?;
        let flags=libc::O_RDONLY|libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_NONBLOCK|if last{0}else{libc::O_DIRECTORY};
        let fd=unsafe{libc::openat(directory.as_raw_fd(),name.as_ptr(),flags)};
        if fd<0{let e=std::io::Error::last_os_error();if last&&missing&&e.kind()==std::io::ErrorKind::NotFound{return Ok(None);}return Err(e.to_string());}
        let file=unsafe{File::from_raw_fd(fd)};
        if last {if !file.metadata().map_err(|e|e.to_string())?.is_file(){return Err("AI access requires a regular file".into());}return Ok(Some(file));}
        directory=file;
    }
    unreachable!()
}

#[tauri::command]
pub fn read_ai_file(project_root:String,path:String,allow_missing:bool)->Result<Option<String>,String>{
    let relative=Path::new(&path);let parts=components(relative)?;
    let source=relative.extension().and_then(|s|s.to_str())==Some("ag");
    let build=parts.first().is_some_and(|p|p=="build")&&parts.len()>=3;
    if !source&&!build{return Err("AI access requires a source or build file".into());}
    let Some(file)=open_scoped(Path::new(&project_root),relative,allow_missing&&source)? else{return Ok(None)};
    let mut bytes=Vec::new();file.take(4_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>4_000_000{return Err("File exceeds AI context limit".into());}
    String::from_utf8(bytes).map(Some).map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn scoped_read_checks_paths_and_missing_files(){
        let temp=tempfile::tempdir().unwrap();let root=temp.path();std::fs::write(root.join("ok.ag"),"public").unwrap();
        let read=|p:&str,missing|read_ai_file(root.to_string_lossy().into(),p.into(),missing);
        assert_eq!(read("ok.ag",false).unwrap().as_deref(),Some("public"));
        assert_eq!(read("new.ag",true).unwrap(),None);
        for path in ["../secret.ag","/secret.ag","C:/secret.ag","ok.ag:stream","private.txt"]{assert!(read(path,false).is_err(),"{path}");}
        std::fs::create_dir_all(root.join("build").join("123")).unwrap();std::fs::write(root.join("build/123/artifact.json"),"{}").unwrap();assert_eq!(read("build/123/artifact.json",false).unwrap().as_deref(),Some("{}"));
    }
    #[test] fn linked_directories_cannot_supply_source_or_build_context(){
        let temp=tempfile::tempdir().unwrap();let root=temp.path().join("project");let outside=temp.path().join("outside");std::fs::create_dir_all(&root).unwrap();std::fs::create_dir_all(&outside).unwrap();std::fs::write(outside.join("secret.ag"),"PRIVATE").unwrap();std::fs::write(outside.join("artifact.json"),"PRIVATE").unwrap();
        #[cfg(unix)] std::os::unix::fs::symlink(&outside,root.join("linked")).unwrap();
        #[cfg(windows)] {let result=std::process::Command::new("cmd").args(["/c","mklink","/J"]).arg(root.join("linked")).arg(&outside).output().unwrap();assert!(result.status.success(), "junction creation failed: {} {}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));}
        assert!(read_ai_file(root.to_string_lossy().into(),"linked/secret.ag".into(),false).is_err());
        std::fs::create_dir(root.join("build")).unwrap();
        #[cfg(unix)] std::os::unix::fs::symlink(&outside,root.join("build").join("123")).unwrap();
        #[cfg(windows)] {let result=std::process::Command::new("cmd").args(["/c","mklink","/J"]).arg(root.join("build").join("123")).arg(&outside).output().unwrap();assert!(result.status.success(), "junction creation failed: {} {}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));}
        assert!(read_ai_file(root.to_string_lossy().into(),"build/123/artifact.json".into(),false).is_err());
        // A linked project root is refused too, even if its contents were already open.
        assert!(read_ai_file(root.join("linked").to_string_lossy().into(),"secret.ag".into(),false).is_err());
    }
    #[cfg(windows)]
    #[test] fn pinned_handles_refuse_boundary_replacement_and_reparse_write_access(){
        use std::os::windows::fs::OpenOptionsExt;
        let temp=tempfile::tempdir().unwrap();let root=temp.path().join("project");std::fs::create_dir(&root).unwrap();std::fs::write(root.join("ok.ag"),"public").unwrap();
        let file=open_scoped_with(&root,Path::new("ok.ag"),false,|p|{
            assert!(std::fs::rename(p,temp.path().join("replaced")).is_err());
            assert!(std::fs::OpenOptions::new().write(true).share_mode(7).custom_flags(0x00200000|0x02000000).open(p).is_err());
        }).unwrap().unwrap();
        assert!(std::fs::rename(root.join("ok.ag"),root.join("replaced.ag")).is_err());
        assert!(std::fs::OpenOptions::new().write(true).share_mode(7).open(root.join("ok.ag")).is_err());
        let mut text=String::new();(&file).read_to_string(&mut text).unwrap();assert_eq!(text,"public");
    }

}
