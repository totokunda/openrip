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
    let path = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d }.join(name);
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

/// HLG frames (iPhone HDR) are converted to SDR the way CapCut shows them: two grey levels
/// against the curve fitted to CapCut's render (docs/parity/hdr.md).
#[test]
fn hlg_frames_are_tone_mapped_to_sdr() {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return;
    }
    let dir = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d };
    let path = dir.join("hlg-greys.mov");
    if !path.exists() {
        // Left half HLG signal 0.5, right half 0.75 (10-bit limited range: 64 + 876 s).
        let (w, h) = (128usize, 64usize);
        let mut raw = Vec::new();
        for _ in 0..10 {
            let luma: Vec<u16> = (0..w * h).map(|i| if i % w < w / 2 { 502 } else { 721 }).collect();
            raw.extend(luma.iter().flat_map(|v| v.to_le_bytes()));
            raw.extend(std::iter::repeat_n(512u16.to_le_bytes(), w * h / 2).flatten());
        }
        let yuv = dir.join("hlg-greys.yuv");
        std::fs::write(&yuv, raw).unwrap();
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuv420p10le", "-s", "128x64", "-r", "30", "-i"])
            .arg(&yuv)
            .args(["-c:v", "libx265", "-x265-params", "qp=0:log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1"])
            .args(["-color_range", "tv", "-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "arib-std-b67"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let Ok(c) = Compositor::new() else { return };
    let mut d = VideoDecoder::open(&path, &DecoderOptions::default()).unwrap();
    let f = d.frame_at(Micros(100_000)).unwrap().unwrap();
    assert_eq!(f.transfer(), openrip_media::Transfer::Hlg);
    let img = c.render(128, 64, [0, 0, 0], &[Layer::from_model(Source::Video(&f), [128, 64], [0.0, 0.0], [1.0, 1.0], 0.0)]);
    let px = |x: u32| &img.data[((32 * 128 + x) * 4) as usize..][..3];
    // Signal 0.5: scene light 1/12 x 1.15, gamma 1/2.4 -> 0.3764 (96.0). Signal 0.75 ->
    // 0.6095 before the shoulder, 0.6094 after (155.4).
    for (x, want) in [(32, 96), (96, 155)] {
        for &v in px(x) {
            assert!((v as i32 - want).abs() <= 2, "x {x}: {v} vs {want}");
        }
    }
}

/// A grey 10-bit clip (BT.709, limited range, `codec`): luma `luma(x)` in 10-bit code values
/// on every row, neutral chroma, so R = G = B = (luma − 64) / 876.
fn grey_clip(name: &str, w: usize, h: usize, codec: &[&str], luma: impl Fn(usize) -> u16) -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        return None;
    }
    let dir = { let d = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("t{:?}", std::thread::current().id())); std::fs::create_dir_all(&d).unwrap(); d };
    let path = dir.join(name);
    if !path.exists() {
        let mut raw = Vec::new();
        for _ in 0..10 {
            raw.extend((0..w * h).flat_map(|i| luma(i % w).to_le_bytes()));
            raw.extend(std::iter::repeat_n(512u16.to_le_bytes(), w * h).flatten());
        }
        let yuv = path.with_extension("yuv");
        std::fs::write(&yuv, raw).unwrap();
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuv422p10le", "-s", &format!("{w}x{h}"), "-r", "30", "-i"])
            .arg(&yuv)
            .args(codec)
            .args(["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    Some(path)
}

/// A table applying `f` to each channel (65 entries a side, at the cube's corners).
fn channel_lut(f: impl Fn(f32) -> f32) -> openrip_render::Lut3d {
    let n = 65;
    let rgb = (0..n * n * n).flat_map(|i| [i % n, i / n % n, i / (n * n)].map(|v| f(v as f32 / (n - 1) as f32))).collect();
    openrip_render::Lut3d { key: 0x1ab, size: n as u32, rgb, edge_aligned: true }
}

/// Log footage spans few code values, and a LUT for it stretches them: a 10-bit ProRes ramp
/// over 90 of them, stretched tenfold, keeps its levels rather than the 8-bit steps of 22.
#[test]
fn a_lut_on_10_bit_video_keeps_its_levels() {
    let Some(path) = grey_clip("lut-ramp.mov", 256, 16, &["-c:v", "prores_ks", "-profile:v", "3"], |x| 370 + (x * 90 / 256) as u16) else { return };
    let Ok(c) = Compositor::new() else { return };
    let mut d = VideoDecoder::open(&path, &DecoderOptions { hardware: HardwareMode::Require, ..Default::default() }).unwrap();
    let f = d.frame_at(Micros(100_000)).unwrap().unwrap();
    assert_eq!(f.pixel_format(), PixelFormat::P210);
    let lut = channel_lut(|v| ((v - 0.35) * 10.0).clamp(0.0, 1.0));
    for (w, h) in [(256, 16), (128, 8)] {
        let img = c.render(w, h, [0, 0, 0], &[Layer { lut: Some((&lut, 1.0)), ..Layer::from_model(Source::Video(&f), [w, h], [0.0, 0.0], [1.0, 1.0], 0.0) }]);
        let row: std::collections::BTreeSet<u8> = (0..w).map(|x| img.data[((h / 2 * w + x) * 4) as usize]).collect();
        assert!(row.len() >= 60, "{w}x{h}: {} levels: {row:?}", row.len());
    }
}
