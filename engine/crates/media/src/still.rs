//! The still-image decode seam: photos, PNG overlays, CapCut's transition frames and covers.
//!
//! PNG is decoded here in Rust, on every platform, keeping its alpha. Anything else goes to
//! the still backends: those a client added with [`add_still_backend`], then the built-in
//! ones, the first to manage wins.
//!
//! Built in today: FFmpeg (JPEG, HEIC, WebP, ...: the stream's first picture, decoded in
//! software). Not written yet: todo: the platform's own image decoders where FFmpeg isn't
//! built (ImageIO on iOS, `BitmapFactory`/`ImageDecoder` on Android, `createImageBitmap` on
//! the web).

use std::path::Path;
use std::sync::{Arc, RwLock};

use openrip_frame::RgbaImage;
use openrip_platform::assets;

/// Decodes still images other than PNG.
pub trait StillBackend: Send + Sync {
    /// The picture at `path` as straight-alpha RGBA; `None` if this backend can't read it
    /// (the next one tries), or why it failed.
    fn decode(&self, path: &Path) -> Option<Result<RgbaImage, String>>;
}

static ADDED: RwLock<Vec<Arc<dyn StillBackend>>> = RwLock::new(Vec::new());

/// Try `backend` before the ones tried so far.
pub fn add_still_backend(backend: Arc<dyn StillBackend>) {
    ADDED.write().unwrap().insert(0, backend);
}

fn built_in() -> Vec<Arc<dyn StillBackend>> {
    vec![Arc::new(crate::decode::Ffmpeg)]
}

/// Decode a still image: PNG directly (keeps alpha), anything else through a still backend.
pub fn decode_still(path: &Path) -> Result<RgbaImage, String> {
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        return load_png(path).map_err(|e| e.to_string());
    }
    let backends: Vec<_> = ADDED.read().unwrap().iter().cloned().chain(built_in()).collect();
    for backend in backends {
        if let Some(done) = backend.decode(path) {
            return done;
        }
    }
    Err(format!("{}: no decoder for this image in this build", path.display()))
}

/// A PNG as straight-alpha RGBA.
pub fn load_png(path: &Path) -> Result<RgbaImage, Box<dyn std::error::Error>> {
    let mut dec = png::Decoder::new(std::io::BufReader::new(assets::open(path)?));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info()?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("png too large")?];
    let info = reader.next_frame(&mut buf)?;
    let px = &buf[..info.buffer_size()];
    let data = match info.color_type {
        // Already RGBA: keep the buffer (a 4K still is 33 MB to copy).
        png::ColorType::Rgba => {
            buf.truncate(info.buffer_size());
            buf
        }
        png::ColorType::Rgb => px.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => px.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        png::ColorType::Grayscale => px.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("indexed png after EXPAND".into()),
    };
    Ok(RgbaImage { width: info.width, height: info.height, data })
}
