//! `openrip-dev transition-sheet <out.png> [--frames N] [--size PX]`: every shader transition
//! (the gl-transitions collection in the compositor) played on two sample pictures, one row
//! per transition in the order of `openrip_render::glt::TABLE`, N frames across. The app's
//! Transitions tab plays a row as the card's hover preview, so the preview is what the
//! compositor (and so the export) draws. The pictures are made here, nothing is shipped with
//! them: a warm sky with a sun, and a cool one with a mountain, as the app's other previews.

use std::path::Path;

use openrip_render::glt::{self, GlFx};
use openrip_render::{Compositor, Layer, Mix, MixMask, RgbaImage, Shot, Source};

fn flag(args: &[String], name: &str, default: u32) -> u32 {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn lerp(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/// Whether (x, y) in 0..1 is inside the polygon.
fn inside(poly: &[(f32, f32)], x: f32, y: f32) -> bool {
    let mut c = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let ((xi, yi), (xj, yj)) = (poly[i], poly[j]);
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            c = !c;
        }
        j = i;
    }
    c
}

fn sample_pictures(size: u32) -> (RgbaImage, RgbaImage) {
    let make = |warm: bool| {
        let mut data = Vec::with_capacity((size * size * 4) as usize);
        let mountain = [(0.0, 1.0), (0.0, 0.7), (0.28, 0.22), (0.46, 0.52), (0.64, 0.08), (1.0, 0.64), (1.0, 1.0)];
        for y in 0..size {
            for x in 0..size {
                let (u, v) = ((x as f32 + 0.5) / size as f32, (y as f32 + 0.5) / size as f32);
                // A diagonal gradient (about CSS's 160deg and 170deg).
                let t = if warm { (u * 0.34 + v * 0.94).clamp(0.0, 1.0) } else { (u * 0.17 + v * 0.98).clamp(0.0, 1.0) };
                let mut c = if warm {
                    if t < 0.55 { lerp([231.0, 164.0, 107.0], [181.0, 88.0, 106.0], t / 0.55) } else { lerp([181.0, 88.0, 106.0], [75.0, 47.0, 85.0], (t - 0.55) / 0.45) }
                } else if t < 0.5 {
                    lerp([156.0, 200.0, 228.0], [77.0, 134.0, 173.0], t / 0.5)
                } else {
                    lerp([77.0, 134.0, 173.0], [31.0, 60.0, 85.0], (t - 0.5) / 0.5)
                };
                if warm {
                    if ((u - 0.5).powi(2) + (v - 0.43).powi(2)).sqrt() < 0.17 {
                        c = [255.0, 227.0, 163.0];
                    }
                } else if v > 0.45 && inside(&mountain, u, (v - 0.45) / 0.55) {
                    c = [36.0, 56.0, 74.0];
                }
                data.extend_from_slice(&[c[0] as u8, c[1] as u8, c[2] as u8, 255]);
            }
        }
        RgbaImage { width: size, height: size, data }
    };
    (make(true), make(false))
}

pub fn sheet(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let out = Path::new(args.get(1).ok_or("usage: transition-sheet <out.png> [--frames N] [--size PX]")?);
    let frames = flag(args, "--frames", 8).max(2);
    let size = flag(args, "--size", 96);
    let compositor = Compositor::new()?;
    let (a, b) = sample_pictures(size);
    let still = Shot { inverse: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], alpha: 1.0, zoom_blur: 0.0, mirror: false };
    let rows = glt::TABLE.len() as u32;
    let width = size * frames;
    let mut sheet = RgbaImage { width, height: size * rows, data: vec![0; (width * size * rows * 4) as usize] };
    for (row, t) in glt::TABLE.iter().enumerate() {
        for frame in 0..frames {
            let fx = GlFx::new(t.id, frame as f32 / (frames - 1) as f32).ok_or("not in the table")?;
            let mut layers = Vec::new();
            for img in [&a, &b] {
                layers.push(Layer::pass(Source::BeginGroup(Some([0, 0, 0]))));
                layers.push(Layer::from_model(img, [size, size], [0.0, 0.0], [1.0, 1.0], 0.0));
                layers.push(Layer::pass(Source::EndGroup));
            }
            layers.push(Layer::pass(Source::Mix(Mix { outgoing: Some(still), incoming: Some(still), mask: MixMask::All, fx: Some(fx) })));
            let img = compositor.render(size, size, [0, 0, 0], &layers);
            for y in 0..size {
                let src = (y * size * 4) as usize;
                let dst = (((row as u32 * size + y) * width + frame * size) * 4) as usize;
                sheet.data[dst..dst + (size * 4) as usize].copy_from_slice(&img.data[src..src + (size * 4) as usize]);
            }
        }
    }
    let mut enc = png::Encoder::new(std::io::BufWriter::new(std::fs::File::create(out)?), sheet.width, sheet.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()?.write_image_data(&sheet.data)?;
    println!("{rows} transitions x {frames} frames of {size} px -> {}", out.display());
    Ok(())
}
