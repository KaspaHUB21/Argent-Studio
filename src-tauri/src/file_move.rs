use std::{io, path::Path};

/// Move a project file to trash without replacing an existing Windows backup.
/// Windows can copy across volumes; an undeleted source is reported as a failure.
pub fn move_to_trash(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(not(windows))]
    { std::fs::rename(source, destination) }
    #[cfg(windows)]
    { move_windows(source, destination) }
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

    #[cfg(windows)]
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
}
