//! Asset access: everything the engine reads (media, CapCut bundles, fonts, saved masks) and
//! the caches it writes, by the name the project stores for it.
//!
//! Names are paths today, and [`FileSystem`] reads them with `std::fs`. A client whose
//! media arrives as handles (an Android `content://` URI, an iOS security-scoped bookmark, a
//! web `File` or `blob:` URL) installs its own [`Assets`] with [`set_assets`] and resolves
//! those names there: a name is any string, carried in a `Path`. [`Memory`] serves blobs
//! held in memory in front of another resolver.
//!
//! Decoders that open files by name themselves (FFmpeg) ask [`Assets::local_path`] for a
//! file on disk; a resolver without one makes them fail cleanly until a decoder reads
//! through [`Assets::open`] instead.

use std::collections::HashMap;
use std::io::{self, Read, Seek};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::UNIX_EPOCH;

/// A readable, seekable asset.
pub trait ReadSeek: Read + Seek + Send {}
impl<T: Read + Seek + Send> ReadSeek for T {}

/// Which version of an asset this is, to key caches by: its size and when it last changed.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Version {
    pub len: u64,
    /// Modification time, nanoseconds since the Unix epoch.
    pub modified_ns: u128,
}

/// Where the engine's assets come from.
pub trait Assets: Send + Sync {
    /// The whole asset.
    fn read(&self, name: &Path) -> io::Result<Vec<u8>>;
    /// The asset to read as a stream.
    fn open(&self, name: &Path) -> io::Result<Box<dyn ReadSeek>>;
    fn exists(&self, name: &Path) -> bool;
    fn is_file(&self, name: &Path) -> bool;
    /// A folder of assets (a CapCut draft or bundle).
    fn is_dir(&self, name: &Path) -> bool;
    /// What a folder holds, as names, in the order the store lists them.
    fn list(&self, dir: &Path) -> io::Result<Vec<PathBuf>>;
    fn version(&self, name: &Path) -> Option<Version>;
    /// Store `data` under `name` (caches), whole or not at all: a reader never sees half of
    /// it. Folders on the way are created.
    fn write(&self, name: &Path, data: &[u8]) -> io::Result<()>;
    /// A file on disk with the asset's bytes, for decoders that open files themselves.
    fn local_path(&self, name: &Path) -> Option<PathBuf>;
}

/// Assets as files, by path.
#[derive(Copy, Clone, Debug, Default)]
pub struct FileSystem;

impl Assets for FileSystem {
    fn read(&self, name: &Path) -> io::Result<Vec<u8>> {
        std::fs::read(name)
    }

    fn open(&self, name: &Path) -> io::Result<Box<dyn ReadSeek>> {
        Ok(Box::new(std::fs::File::open(name)?))
    }

    fn exists(&self, name: &Path) -> bool {
        name.exists()
    }

    fn is_file(&self, name: &Path) -> bool {
        name.is_file()
    }

    fn is_dir(&self, name: &Path) -> bool {
        name.is_dir()
    }

    fn list(&self, dir: &Path) -> io::Result<Vec<PathBuf>> {
        Ok(std::fs::read_dir(dir)?.filter_map(Result::ok).map(|e| e.path()).collect())
    }

    fn version(&self, name: &Path) -> Option<Version> {
        let meta = std::fs::metadata(name).ok()?;
        let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
        Some(Version { len: meta.len(), modified_ns: mtime.as_nanos() })
    }

    fn write(&self, name: &Path, data: &[u8]) -> io::Result<()> {
        if let Some(dir) = name.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // Write then rename, so a reader never sees half a file.
        let tmp = name.with_extension("tmp");
        std::fs::write(&tmp, data)?;
        std::fs::rename(tmp, name)
    }

    fn local_path(&self, name: &Path) -> Option<PathBuf> {
        Some(name.to_path_buf())
    }
}

/// Blobs held in memory, in front of another resolver: names it holds are served from
/// memory, anything else goes to the one behind. For media a client has as bytes (a web
/// upload, a file picked on a phone) rather than as a file.
pub struct Memory {
    blobs: RwLock<HashMap<PathBuf, Arc<[u8]>>>,
    behind: Arc<dyn Assets>,
}

impl Memory {
    pub fn new(behind: Arc<dyn Assets>) -> Memory {
        Memory { blobs: RwLock::new(HashMap::new()), behind }
    }

    /// Serve `data` as `name` (replacing what was there).
    pub fn insert(&self, name: impl Into<PathBuf>, data: impl Into<Arc<[u8]>>) {
        self.blobs.write().unwrap().insert(name.into(), data.into());
    }

    pub fn remove(&self, name: &Path) {
        self.blobs.write().unwrap().remove(name);
    }

    fn blob(&self, name: &Path) -> Option<Arc<[u8]>> {
        self.blobs.read().unwrap().get(name).cloned()
    }
}

/// A blob as a stream.
struct Blob(Arc<[u8]>);

impl AsRef<[u8]> for Blob {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Assets for Memory {
    fn read(&self, name: &Path) -> io::Result<Vec<u8>> {
        match self.blob(name) {
            Some(b) => Ok(b.to_vec()),
            None => self.behind.read(name),
        }
    }

    fn open(&self, name: &Path) -> io::Result<Box<dyn ReadSeek>> {
        match self.blob(name) {
            Some(b) => Ok(Box::new(io::Cursor::new(Blob(b)))),
            None => self.behind.open(name),
        }
    }

    fn exists(&self, name: &Path) -> bool {
        self.blob(name).is_some() || self.behind.exists(name)
    }

    fn is_file(&self, name: &Path) -> bool {
        self.blob(name).is_some() || self.behind.is_file(name)
    }

    fn is_dir(&self, name: &Path) -> bool {
        self.behind.is_dir(name)
    }

    fn list(&self, dir: &Path) -> io::Result<Vec<PathBuf>> {
        let held: Vec<PathBuf> = self.blobs.read().unwrap().keys().filter(|k| k.parent() == Some(dir)).cloned().collect();
        match self.behind.list(dir) {
            Ok(mut out) => {
                let extra: Vec<PathBuf> = held.into_iter().filter(|k| !out.contains(k)).collect();
                out.extend(extra);
                Ok(out)
            }
            Err(_) if !held.is_empty() => Ok(held),
            Err(e) => Err(e),
        }
    }

    fn version(&self, name: &Path) -> Option<Version> {
        match self.blob(name) {
            // Blobs don't change under a name; replacing one is a new version only by size.
            Some(b) => Some(Version { len: b.len() as u64, modified_ns: 0 }),
            None => self.behind.version(name),
        }
    }

    fn write(&self, name: &Path, data: &[u8]) -> io::Result<()> {
        self.behind.write(name, data)
    }

    fn local_path(&self, name: &Path) -> Option<PathBuf> {
        match self.blob(name) {
            Some(_) => None,
            None => self.behind.local_path(name),
        }
    }
}

static ASSETS: RwLock<Option<Arc<dyn Assets>>> = RwLock::new(None);

/// Read and write the engine's assets through `assets` from now on.
pub fn set_assets(assets: Arc<dyn Assets>) {
    *ASSETS.write().unwrap() = Some(assets);
}

/// The resolver in use: the client's, or [`FileSystem`].
pub fn assets() -> Arc<dyn Assets> {
    ASSETS.read().unwrap().clone().unwrap_or_else(|| Arc::new(FileSystem))
}

// Shorthands for the resolver in use.

pub fn read(name: &Path) -> io::Result<Vec<u8>> {
    assets().read(name)
}

pub fn read_to_string(name: &Path) -> io::Result<String> {
    String::from_utf8(read(name)?).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "stream did not contain valid UTF-8"))
}

pub fn open(name: &Path) -> io::Result<Box<dyn ReadSeek>> {
    assets().open(name)
}

pub fn exists(name: &Path) -> bool {
    assets().exists(name)
}

pub fn is_file(name: &Path) -> bool {
    assets().is_file(name)
}

pub fn is_dir(name: &Path) -> bool {
    assets().is_dir(name)
}

pub fn list(dir: &Path) -> io::Result<Vec<PathBuf>> {
    assets().list(dir)
}

pub fn version(name: &Path) -> Option<Version> {
    assets().version(name)
}

pub fn write(name: &Path, data: &[u8]) -> io::Result<()> {
    assets().write(name, data)
}

pub fn local_path(name: &Path) -> Option<PathBuf> {
    assets().local_path(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_serves_its_blobs_and_passes_the_rest_on() {
        let dir = std::env::temp_dir().join(format!("openrip-assets-{}", std::process::id()));
        let file = dir.join("on-disk.txt");
        FileSystem.write(&file, b"disk").unwrap();
        let mem = Memory::new(Arc::new(FileSystem));
        mem.insert(dir.join("blob.bin"), b"blob".to_vec());
        assert_eq!(mem.read(&dir.join("blob.bin")).unwrap(), b"blob");
        assert_eq!(mem.read(&file).unwrap(), b"disk");
        let mut s = String::new();
        mem.open(&dir.join("blob.bin")).unwrap().read_to_string(&mut s).unwrap();
        assert_eq!(s, "blob");
        assert!(mem.local_path(&dir.join("blob.bin")).is_none());
        assert_eq!(mem.local_path(&file), Some(file.clone()));
        let mut listed = mem.list(&dir).unwrap();
        listed.sort();
        assert_eq!(listed, vec![dir.join("blob.bin"), file.clone()]);
        assert_eq!(mem.version(&dir.join("blob.bin")).map(|v| v.len), Some(4));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writes_are_whole() {
        let dir = std::env::temp_dir().join(format!("openrip-assets-w-{}", std::process::id()));
        let file = dir.join("a").join("cache.bin");
        FileSystem.write(&file, b"one").unwrap();
        FileSystem.write(&file, b"two").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"two");
        assert!(!file.with_extension("tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
