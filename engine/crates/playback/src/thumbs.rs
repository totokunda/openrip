//! Timeline thumbnails: small frames of a clip at chosen source times, quick first and exact
//! after.
//!
//! The quick pass decodes one keyframe per GOP and lets it stand in for every time in that
//! GOP, so a strip appears after a handful of decodes. The exact pass decodes the frame shown
//! at each time, in time order so neighbouring thumbnails share decoding work. Exact
//! thumbnails go to a disk cache (when given one), keyed by the file's path, size and
//! modification time, and later passes of either kind return them from there.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use openrip_media::{open_video, Decoder, DecoderOptions, Micros, VideoFrame, VideoSource};
use openrip_render::{Compositor, Layer, RgbaImage, Source};

use crate::preview::{load_png, load_still};
use crate::PreviewError;

/// Decoders kept open between requests (the timeline asks for the same few clips again
/// and again as it scrolls and zooms).
const MAX_DECODERS: usize = 4;
/// Thumbnails step through the file; a small frame cache is enough.
const DECODER_CACHE: usize = 32 << 20;

pub struct Thumb {
    /// Index into the requested times.
    pub index: usize,
    /// The requested source time.
    pub time: Micros,
    /// False for a stand-in: the keyframe of the GOP the time falls in.
    pub exact: bool,
    pub image: RgbaImage,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Pass {
    /// One keyframe per GOP, standing in for every time in it (and exact thumbnails already
    /// on disk).
    Quick,
    /// The frame shown at each time.
    Exact,
}

struct Open {
    decoder: Decoder,
    last_used: u64,
}

pub struct Thumbnailer {
    compositor: Compositor,
    decoders: HashMap<PathBuf, Open>,
    tick: u64,
    cache_dir: Option<PathBuf>,
}

impl Thumbnailer {
    /// `cache_dir` keeps exact thumbnails across runs (created if missing); `None` keeps
    /// nothing.
    pub fn new(cache_dir: Option<PathBuf>) -> Result<Self, PreviewError> {
        Ok(Thumbnailer { compositor: Compositor::new()?, decoders: HashMap::new(), tick: 0, cache_dir })
    }

    /// Thumbnails `height` pixels tall (width from the upright picture's aspect) of the video
    /// or still at `path`, at source `times`. Each one goes to `deliver` as it is ready, in
    /// no particular order; `deliver` returning false stops the pass.
    pub fn thumbnails(&mut self, path: &Path, times: &[Micros], height: u32, pass: Pass, mut deliver: impl FnMut(Thumb) -> bool) -> Result<(), PreviewError> {
        let height = height.max(1);
        let disk = self.cache_dir.as_ref().and_then(|dir| media_key(path).map(|k| dir.join(k)));
        // Exact thumbnails already on disk.
        let mut todo = Vec::new();
        for (index, &time) in times.iter().enumerate() {
            match disk.as_ref().and_then(|d| load_png(&thumb_file(d, height, time)).ok()) {
                Some(image) => {
                    if !deliver(Thumb { index, time, exact: true, image }) {
                        return Ok(());
                    }
                }
                None => todo.push((index, time)),
            }
        }
        if todo.is_empty() {
            return Ok(());
        }
        if is_still(path) {
            let img = load_still(path).map_err(|msg| openrip_media::MediaError::Open { path: path.to_path_buf(), msg })?;
            let image = self.scale(Source::Image(&img), height, 0);
            for (index, time) in todo {
                if !deliver(Thumb { index, time, exact: true, image: image.clone() }) {
                    break;
                }
            }
            return Ok(());
        }
        self.tick += 1;
        let tick = self.tick;
        if !self.decoders.contains_key(path) {
            let decoder = open_video(path, &DecoderOptions { cache_bytes: DECODER_CACHE, ..Default::default() })?;
            self.decoders.insert(path.to_path_buf(), Open { decoder, last_used: tick });
            while self.decoders.len() > MAX_DECODERS {
                let oldest = self.decoders.iter().min_by_key(|(_, o)| o.last_used).map(|(k, _)| k.clone()).unwrap();
                self.decoders.remove(&oldest);
            }
        }
        let mut open = self.decoders.remove(path).unwrap();
        open.last_used = tick;
        let result = self.decode(open.decoder.as_mut(), &todo, height, pass, disk.as_deref(), &mut deliver);
        self.decoders.insert(path.to_path_buf(), open);
        result
    }

    fn decode(&mut self, d: &mut dyn VideoSource, todo: &[(usize, Micros)], height: u32, pass: Pass, disk: Option<&Path>, deliver: &mut impl FnMut(Thumb) -> bool) -> Result<(), PreviewError> {
        let rotation = d.info().rotation;
        let mut order = todo.to_vec();
        order.sort_by_key(|&(_, t)| t);
        match pass {
            Pass::Exact => {
                for (index, time) in order {
                    let Some(frame) = d.frame_at(time)? else { continue };
                    let image = self.scale(Source::Video(&frame), height, rotation);
                    if let Some(dir) = disk {
                        // Best effort: a full disk only costs the cache.
                        let _ = save_png(&thumb_file(dir, height, time), &image);
                    }
                    if !deliver(Thumb { index, time, exact: true, image }) {
                        break;
                    }
                }
            }
            Pass::Quick => {
                // Group by GOP; without an index each time is its own group.
                let mut i = 0;
                while i < order.len() {
                    let key = d.keyframe_time(order[i].1);
                    let mut j = i + 1;
                    while j < order.len() && key.is_some() && d.keyframe_time(order[j].1) == key {
                        j += 1;
                    }
                    let Some(frame) = d.keyframe_at(order[i].1)? else {
                        i = j;
                        continue;
                    };
                    let image = self.scale(Source::Video(&frame), height, rotation);
                    for &(index, time) in &order[i..j] {
                        let exact = shows(&frame, d, time);
                        if !deliver(Thumb { index, time, exact, image: image.clone() }) {
                            return Ok(());
                        }
                    }
                    i = j;
                }
            }
        }
        Ok(())
    }

    /// The picture upright and `height` tall, area-averaged down.
    fn scale(&mut self, source: Source<'_>, height: u32, rotation: i32) -> RgbaImage {
        shrink(&self.compositor, source, height, rotation)
    }
}

/// A picture upright (`rotation` the clockwise turn that shows it so) and `height` tall,
/// area-averaged down.
pub(crate) fn shrink(compositor: &Compositor, source: Source<'_>, height: u32, rotation: i32) -> RgbaImage {
    let (w, h) = source.size();
    let (uw, uh) = if rotation.rem_euclid(180) == 90 { (h, w) } else { (w, h) };
    let width = ((height as f64 * uw as f64 / uh.max(1) as f64).round() as u32).max(1);
    // The GPU area filter loops over each output pixel's footprint, so a 4K frame down
    // to 64 px is ~1,000 reads per pixel on few threads (9 ms). Stop the GPU at up to
    // 6x reduction and finish with an exact box filter on the CPU.
    let k = ((uh as f64 / height as f64 / 6.0).ceil() as u32).max(1);
    let layer = Layer::from_model_oriented(source, [width * k, height * k], [0.0, 0.0], [1.0, 1.0], 0.0, rotation);
    let big = compositor.render(width * k, height * k, [0, 0, 0], &[layer]);
    box_down(&big, k)
}

/// Average each `k`x`k` block (the image is an exact multiple of `k` on both sides).
fn box_down(img: &RgbaImage, k: u32) -> RgbaImage {
    if k == 1 {
        return img.clone();
    }
    let (w, h) = (img.width / k, img.height / k);
    let mut data = vec![0u8; (w * h * 4) as usize];
    let n = k * k;
    for y in 0..h {
        for x in 0..w {
            let mut sum = [0u32; 4];
            for dy in 0..k {
                let row = ((y * k + dy) * img.width + x * k) as usize * 4;
                for px in img.data[row..row + k as usize * 4].chunks_exact(4) {
                    for c in 0..4 {
                        sum[c] += px[c] as u32;
                    }
                }
            }
            let o = ((y * w + x) * 4) as usize;
            for c in 0..4 {
                data[o + c] = ((sum[c] + n / 2) / n) as u8;
            }
        }
    }
    RgbaImage { width: w, height: h, data }
}

/// Whether `frame` (a keyframe) is the frame shown at `t`: `t` falls before the next frame.
fn shows(frame: &VideoFrame, d: &dyn VideoSource, t: Micros) -> bool {
    let step = d.info().frame_rate.map_or(Micros(33_333), |r| r.frame_duration());
    t >= frame.time && t.0 < frame.time.0 + step.0
}

pub(crate) fn is_still(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    matches!(ext.as_deref(), Some("png" | "jpg" | "jpeg" | "webp" | "bmp" | "tif" | "tiff" | "heic" | "gif"))
}

/// A folder name for one version of a file: its path, size and modification time.
pub(crate) fn media_key(path: &Path) -> Option<String> {
    let v = openrip_platform::assets::version(path)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (path, v.len, v.modified_ns).hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

fn thumb_file(dir: &Path, height: u32, t: Micros) -> PathBuf {
    dir.join(format!("{height}-{}.png", t.0))
}

fn save_png(file: &Path, img: &RgbaImage) -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    let mut enc = png::Encoder::new(&mut bytes, img.width, img.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    enc.write_header()?.write_image_data(&img.data)?;
    // Whole or not at all, so a reader never sees half a file.
    openrip_platform::assets::write(file, &bytes)?;
    Ok(())
}
