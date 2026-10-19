//! Sticker files to frames: the content decides, not the extension. A still or animated PNG
//! (APNG), a GIF, a still or animated WebP, or an SVG drawn to a bitmap. All pure Rust, so a
//! sticker draws the same on every platform the engine runs on.

use openrip_render::RgbaImage;

/// The longer side an SVG sticker is drawn at: the layer scales the bitmap to its size on the
/// canvas, so this only has to be sharp enough for the largest a sticker is put at.
pub const SVG_LONG_SIDE: u32 = 512;

/// A frame and how long it shows, in ms (a still's is 0).
pub type Timed = (RgbaImage, u32);

/// Every frame of a sticker file's bytes.
pub fn decode(bytes: &[u8]) -> Result<Vec<Timed>, String> {
    if bytes.starts_with(b"GIF8") {
        let frames = crate::gif::decode(bytes).ok_or("not a GIF")?;
        return Ok(frames.into_iter().map(|f| (f.image, f.delay_ms)).collect());
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return apng(bytes);
    }
    if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return webp(bytes);
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]);
    if head.contains("<svg") || head.trim_start().starts_with("<?xml") {
        return Ok(vec![(svg(bytes)?, 0)]);
    }
    Err("not a PNG, GIF, WebP or SVG".into())
}

/// An SVG drawn to a bitmap with its longer side `SVG_LONG_SIDE` pixels.
pub fn svg(bytes: &[u8]) -> Result<RgbaImage, String> {
    let tree = resvg::usvg::Tree::from_data(bytes, &resvg::usvg::Options::default()).map_err(|e| e.to_string())?;
    let size = tree.size();
    let k = SVG_LONG_SIDE as f32 / size.width().max(size.height()).max(1e-3);
    let (w, h) = (((size.width() * k).round() as u32).max(1), ((size.height() * k).round() as u32).max(1));
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).ok_or("the SVG's size is empty")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(w as f32 / size.width(), h as f32 / size.height()), &mut pixmap.as_mut());
    // The pixmap is premultiplied: the layers take straight alpha.
    let mut data = pixmap.take();
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a != 0 && a != 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    Ok(RgbaImage { width: w, height: h, data })
}

fn webp(bytes: &[u8]) -> Result<Vec<Timed>, String> {
    let mut dec = image_webp::WebPDecoder::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let (w, h) = dec.dimensions();
    let rgba = dec.has_alpha();
    let size = dec.output_buffer_size().ok_or("the WebP is too large")?;
    let frames = if dec.is_animated() { dec.num_frames().max(1) } else { 1 };
    let mut out = Vec::new();
    for _ in 0..frames {
        let mut buf = vec![0u8; size];
        let delay = if dec.is_animated() { dec.read_frame(&mut buf).map_err(|e| e.to_string())? } else { dec.read_image(&mut buf).map_err(|e| e.to_string()).map(|_| 0)? };
        let data = if rgba { buf } else { buf.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect() };
        out.push((RgbaImage { width: w, height: h, data }, delay));
    }
    Ok(out)
}

/// A PNG, still or animated: the animation's frames composed onto the canvas by their
/// offsets, disposal and blend, as a browser composes them.
fn apng(bytes: &[u8]) -> Result<Vec<Timed>, String> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| e.to_string())?;
    let (w, h) = (reader.info().width as usize, reader.info().height as usize);
    let count = reader.info().animation_control().map_or(1, |a| a.num_frames.max(1)) as usize;
    let mut canvas = vec![0u8; w * h * 4];
    let mut out: Vec<Timed> = Vec::new();
    let mut buf = vec![0; reader.output_buffer_size().ok_or("png too large")?];
    for _ in 0..count {
        let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
        let px = &buf[..info.buffer_size()];
        let rgba: Vec<u8> = match info.color_type {
            png::ColorType::Rgba => px.to_vec(),
            png::ColorType::Rgb => px.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
            png::ColorType::GrayscaleAlpha => px.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
            png::ColorType::Grayscale => px.iter().flat_map(|&g| [g, g, g, 255]).collect(),
            png::ColorType::Indexed => return Err("indexed png after EXPAND".into()),
        };
        let Some(fc) = reader.info().frame_control().copied() else {
            // A still: the picture as it is.
            return Ok(vec![(RgbaImage { width: info.width, height: info.height, data: rgba }, 0)]);
        };
        let (fw, fh, x0, y0) = (fc.width as usize, fc.height as usize, fc.x_offset as usize, fc.y_offset as usize);
        let before = matches!(fc.dispose_op, png::DisposeOp::Previous).then(|| canvas.clone());
        for y in 0..fh.min(h.saturating_sub(y0)) {
            for x in 0..fw.min(w.saturating_sub(x0)) {
                let src = &rgba[(y * fw + x) * 4..][..4];
                let dst = &mut canvas[((y0 + y) * w + x0 + x) * 4..][..4];
                if matches!(fc.blend_op, png::BlendOp::Source) || src[3] == 255 {
                    dst.copy_from_slice(src);
                } else if src[3] != 0 {
                    // Source over, in straight alpha.
                    let (sa, da) = (src[3] as f32 / 255.0, dst[3] as f32 / 255.0);
                    let oa = sa + da * (1.0 - sa);
                    for c in 0..3 {
                        dst[c] = ((src[c] as f32 * sa + dst[c] as f32 * da * (1.0 - sa)) / oa).round() as u8;
                    }
                    dst[3] = (oa * 255.0).round() as u8;
                }
            }
        }
        let den = if fc.delay_den == 0 { 100 } else { fc.delay_den as u32 };
        out.push((RgbaImage { width: w as u32, height: h as u32, data: canvas.clone() }, fc.delay_num as u32 * 1000 / den));
        match fc.dispose_op {
            png::DisposeOp::Background => {
                for y in y0..(y0 + fh).min(h) {
                    canvas[(y * w + x0) * 4..(y * w + (x0 + fw).min(w)) * 4].fill(0);
                }
            }
            png::DisposeOp::Previous => canvas = before.unwrap_or(canvas),
            png::DisposeOp::None => {}
        }
    }
    Ok(out)
}
