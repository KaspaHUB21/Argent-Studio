use std::{io, path::Path};

/// Move a project file to trash without replacing an existing backup.
/// Windows can copy across volumes; an undeleted source is reported as a failure.
pub fn move_to_trash(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(target_os="macos")]
    { move_macos(source, destination) }
    #[cfg(not(any(windows, target_os="macos")))]
    { std::fs::rename(source, destination) }
    #[cfg(windows)]
    { move_windows(source, destination) }
}

#[cfg(target_os="macos")]
fn rename_exclusive(source: &Path, destination: &Path) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let from = CString::new(source.as_os_str().as_bytes()).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput,e))?;
    let to = CString::new(destination.as_os_str().as_bytes()).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput,e))?;
    if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

#[cfg(target_os="macos")]
fn move_macos(source: &Path, destination: &Path) -> io::Result<()> {
    match rename_exclusive(source, destination) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(libc::EXDEV) => move_across_volumes(source, destination, || {}),
        Err(error) => Err(error),
    }
}

#[cfg(target_os="macos")]
fn move_across_volumes(source: &Path, destination: &Path, after_stage: impl FnOnce()) -> io::Result<()> {
    use std::fs;
    let parent=source.parent().ok_or_else(||io::Error::other("File parent missing"))?;
    // Stage on the source volume first. A concurrent save recreating the original
    // pathname must never be removed after copying the older open file.
    let staging=tempfile::Builder::new().prefix(".argent-trash-").tempdir_in(parent)?.keep();
    let staged=staging.join("original");
    if let Err(error)=rename_exclusive(source,&staged){let _=fs::remove_dir(&staging);return Err(error);}
    after_stage();
    let result=copy_to_trash(&staged,destination);
    if let Err(error)=result {
        if rename_exclusive(&staged,source).is_err(){return Err(io::Error::new(error.kind(),format!("{}; original preserved at {}",error,staged.display())));}
        let _=fs::remove_dir(&staging);
        return Err(error);
    }
    let _=fs::remove_dir(&staging);
    Ok(())
}

#[cfg(target_os="macos")]
fn copy_to_trash(source: &Path, destination: &Path) -> io::Result<()> {
    use std::fs::{self, OpenOptions};
    use std::os::unix::fs::OpenOptionsExt;
    let mut input=OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW|libc::O_NONBLOCK).open(source)?;
    let metadata=input.metadata()?;
    if !metadata.is_file(){return Err(io::Error::other("Trash requires a regular file"));}
    let mut output=OpenOptions::new().write(true).create_new(true).mode(0o600).open(destination)?;
    let copied=(|| -> io::Result<()> {
        std::io::copy(&mut input,&mut output)?;
        output.set_permissions(metadata.permissions())?;
        output.sync_all()
    })();
    if let Err(error)=copied{drop(output);let _=fs::remove_file(destination);return Err(error);}
    fs::remove_file(source)
}

#[cfg(windows)]
fn wide_path(path: &Path) -> io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    let mut value: Vec<u16> = path.as_os_str().encode_wide().collect();
    if value.contains(&0) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "A file path contains a null character")); }
    value.push(0);
    Ok(value)
}

#[cfg(windows)]
fn move_windows(source: &Path, destination: &Path) -> io::Result<()> {
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    // Reject embedded NULs before calling native filesystem APIs.
    wide_path(source)?;
    wide_path(destination)?;
    let source = source.canonicalize()?;
    let parent = destination.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Trash destination has no parent"))?;
    let name = destination.file_name().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Trash destination has no file name"))?;
    let destination = parent.canonicalize()?.join(name);
    let source_wide = wide_path(&source)?;
    let destination_wide = wide_path(&destination)?;
    const COPY_ALLOWED: u32 = 0x2;
    const WRITE_THROUGH: u32 = 0x8;
    // No REPLACE_EXISTING: an older backup must never be overwritten.
    let result = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), COPY_ALLOWED | WRITE_THROUGH) };
    if result == 0 { return Err(io::Error::last_os_error()); }
    // COPY_ALLOWED may report success even if deleting the original failed.
    if source.try_exists()? {
        return Err(io::Error::other("The file was copied to trash, but the original could not be removed; both copies have been preserved"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_file_and_preserves_its_contents() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.ag");
        let destination = directory.path().join("saved.ag");
        std::fs::write(&source, b"app Tickets {}\n").unwrap();
        move_to_trash(&source, &destination).unwrap();
        assert!(!source.exists());
        assert_eq!(std::fs::read(&destination).unwrap(), b"app Tickets {}\n");
    }

    #[cfg(any(windows, target_os="macos"))]
    #[test]
    fn existing_backup_preserves_both_files() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.ag");
        let destination = directory.path().join("saved.ag");
        std::fs::write(&source, b"new content").unwrap();
        std::fs::write(&destination, b"older backup").unwrap();
        assert!(move_to_trash(&source, &destination).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"new content");
        assert_eq!(std::fs::read(&destination).unwrap(), b"older backup");
    }

    #[cfg(windows)]
    #[test]
    fn null_characters_are_rejected() {
        assert_eq!(wide_path(Path::new("file\0.ag")).unwrap_err().kind(), io::ErrorKind::InvalidInput);
    }
    #[cfg(target_os="macos")]
    #[test]
    fn concurrent_save_during_cross_volume_copy_is_preserved() {
        let directory=tempfile::tempdir().unwrap();
        let source=directory.path().join("source.ag");let destination=directory.path().join("trash.ag");
        std::fs::write(&source,"old content").unwrap();
        move_across_volumes(&source,&destination,||std::fs::write(&source,"new saved content").unwrap()).unwrap();
        assert_eq!(std::fs::read_to_string(&source).unwrap(),"new saved content");
        assert_eq!(std::fs::read_to_string(&destination).unwrap(),"old content");
    }
    #[cfg(target_os="macos")]
    #[test]
    fn failed_cross_volume_copy_restores_source_without_overwriting_backup() {
        let directory=tempfile::tempdir().unwrap();
        let source=directory.path().join("source.ag");let destination=directory.path().join("trash.ag");
        std::fs::write(&source,"source").unwrap();std::fs::write(&destination,"backup").unwrap();
        assert!(move_across_volumes(&source,&destination,||{}).is_err());
        assert_eq!(std::fs::read_to_string(&source).unwrap(),"source");
        assert_eq!(std::fs::read_to_string(&destination).unwrap(),"backup");
    }

    #[cfg(target_os="macos")]
    #[test]
    fn failed_copy_and_concurrent_save_preserve_all_versions() {
        let directory=tempfile::tempdir().unwrap();
        let source=directory.path().join("source.ag");let destination=directory.path().join("trash.ag");
        std::fs::write(&source,"old source").unwrap();std::fs::write(&destination,"backup").unwrap();
        assert!(move_across_volumes(&source,&destination,||std::fs::write(&source,"new source").unwrap()).is_err());
        assert_eq!(std::fs::read_to_string(&source).unwrap(),"new source");
        assert_eq!(std::fs::read_to_string(&destination).unwrap(),"backup");
        let recovery=std::fs::read_dir(directory.path()).unwrap().map(|e|e.unwrap().path()).find(|p|p.is_dir()).unwrap();
        assert_eq!(std::fs::read_to_string(recovery.join("original")).unwrap(),"old source");
    }

}
