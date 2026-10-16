//! Hardware frames go to the GPU without a copy (IOSurface planes) and are converted there.
//! Compare against FFmpeg's (swscale) conversion of the same frame on the CPU.

#![cfg(target_os = "macos")]

use std::path::PathBuf;
use std::process::Command;

use openrip_media::{DecoderOptions, HardwareMode, Micros, PixelFormat, VideoDecoder};
use openrip_render::{Compositor, Layer, RgbaImage, Source};

fn clip(name: &str, pix_fmt: &str, codec: &[&str]) -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return None;
    }
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    if !path.exists() {
        let ext = path.extension().unwrap().to_str().unwrap().to_owned();
        let tmp = path.with_extension(format!("tmp.{ext}"));
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-frames:v", "30", "-pix_fmt", pix_fmt])
            .args(codec)
            .args(["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"])
            .arg(&tmp)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        std::fs::rename(tmp, &path).unwrap();
    }
    Some(path)
}

fn check(path: PathBuf, format: PixelFormat) {
    let Ok(c) = Compositor::new() else { return };
    let mut d = VideoDecoder::open(&path, &DecoderOptions { hardware: HardwareMode::Require, ..Default::default() }).unwrap();
    let f = d.frame_at(Micros(500_000)).unwrap().unwrap();
    assert!(f.is_hardware());
    assert_eq!(f.pixel_format(), format);
    let (w, h) = (f.width(), f.height());
    let gpu = c.render(w, h, [0, 0, 0], &[Layer::from_model(Source::Video(&f), [w, h], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    let rgb = f.to_rgb().unwrap();
    let cpu = RgbaImage { width: w, height: h, data: rgb.data.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect() };
    // Compare where the picture is locally flat (3x3 neighbourhood within 2 code values):
    // there the conversion maths must agree; at sharp colour edges the chroma filters differ
    // (swscale interpolates chroma bicubically, the GPU bilinearly).
    let at = |img: &RgbaImage, x: u32, y: u32, c: usize| img.data[((y * w + x) * 4) as usize + c] as i32;
    let (mut flat, mut close, mut sum, mut signed) = (0usize, 0usize, 0i64, [0i64; 3]);
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let is_flat = (0..3).all(|c| {
                let v: Vec<i32> = (0..9).map(|i| at(&cpu, x + i % 3 - 1, y + i / 3 - 1, c)).collect();
                v.iter().max().unwrap() - v.iter().min().unwrap() <= 2
            });
            if !is_flat {
                continue;
            }
            flat += 1;
            let d: Vec<i32> = (0..3).map(|c| at(&gpu, x, y, c) - at(&cpu, x, y, c)).collect();
            for c in 0..3 {
                signed[c] += d[c] as i64;
            }
            sum += d.iter().map(|v| v.abs() as i64).sum::<i64>();
            if d.iter().all(|v| v.abs() <= 1) {
                close += 1;
            }
        }
    }
    let mean = sum as f64 / (flat * 3) as f64;
    let bias: Vec<f64> = signed.iter().map(|s| *s as f64 / flat as f64).collect();
    assert!(flat > (w * h / 4) as usize, "{format:?}: only {flat} flat pixels");
    assert!(mean < 0.5 && close as f64 / flat as f64 > 0.99, "{format:?}: flat areas mean |diff| {mean:.2}, {:.1}% within 1, bias {bias:?}", 100.0 * close as f64 / flat as f64);
}

#[test]
fn nv12_frames_convert_on_the_gpu() {
    if let Some(p) = clip("import-h264.mp4", "yuv420p", &["-c:v", "libx264", "-preset", "veryfast"]) {
        check(p, PixelFormat::Nv12);
    }
}

#[test]
fn p010_frames_convert_on_the_gpu() {
    if let Some(p) = clip("import-hevc10.mp4", "yuv420p10le", &["-c:v", "libx265", "-x265-params", "log-level=none", "-tag:v", "hvc1"]) {
        check(p, PixelFormat::P010);
    }
}

#[test]
fn p210_prores_frames_convert_on_the_gpu() {
    if let Some(p) = clip("import-prores.mov", "yuv422p10le", &["-c:v", "prores_ks", "-profile:v", "2"]) {
        check(p, PixelFormat::P210);
    }
}
