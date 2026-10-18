//! Frame-accuracy tests. Each fixture clip carries its frame number as a 10-bit barcode
//! (64-px black/white blocks), so every decoded frame can be checked against the frame the
//! decoder claims it is. Fixtures are generated with the `ffmpeg` CLI (tests skip without it).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use openrip_media::{probe, DecoderOptions, FrameRate, HardwareMode, Micros, PixelFormat, ReverseReader, VideoDecoder, VideoFrame};

const FRAMES: i64 = 300;
const BARCODE: &str = "geq=lum='255*mod(floor(N/pow(2,floor(X/64))),2)'";

struct Clip {
    name: &'static str,
    /// Extra filters after the barcode, e.g. a frame-rate change or VFR timestamps.
    filters: &'static str,
    rate: &'static str,
    args: &'static [&'static str],
    /// Expected start time of frame n.
    time: fn(i64) -> Micros,
}

fn cfr30(n: i64) -> Micros {
    FrameRate::new(30, 1).frame_start(n)
}
fn ntsc(n: i64) -> Micros {
    FrameRate::new(30000, 1001).frame_start(n)
}
/// 30 fps with a 0.5 s hole before frame 150.
fn vfr(n: i64) -> Micros {
    cfr30(n) + Micros(if n >= 150 { 500_000 } else { 0 })
}

const X264: &[&str] = &["-c:v", "libx264", "-preset", "veryfast", "-bf", "3", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-pix_fmt", "yuv420p"];

fn clips() -> Vec<Clip> {
    vec![
        Clip { name: "h264_bframes.mp4", filters: "", rate: "30", args: X264, time: cfr30 },
        Clip {
            name: "h264_open_gop.mp4",
            filters: "",
            rate: "30",
            args: &["-c:v", "libx264", "-preset", "veryfast", "-x264-params", "open_gop=1:keyint=48:min-keyint=48:scenecut=0:bframes=3", "-pix_fmt", "yuv420p"],
            time: cfr30,
        },
        Clip {
            name: "hevc.mp4",
            filters: "",
            rate: "30",
            args: &["-c:v", "libx265", "-x265-params", "log-level=none:keyint=48:min-keyint=48:scenecut=0:bframes=4", "-tag:v", "hvc1", "-pix_fmt", "yuv420p"],
            time: cfr30,
        },
        Clip {
            name: "hevc_10bit.mp4",
            filters: "",
            rate: "30",
            args: &["-c:v", "libx265", "-x265-params", "log-level=none:keyint=48:min-keyint=48:scenecut=0", "-tag:v", "hvc1", "-pix_fmt", "yuv420p10le"],
            time: cfr30,
        },
        Clip { name: "h264_2997.mp4", filters: "", rate: "30000/1001", args: X264, time: ntsc },
        Clip { name: "h264_offset.ts", filters: "", rate: "30", args: X264, time: cfr30 },
        Clip {
            name: "h264_vfr.mp4",
            // Integer ticks of the 1/30 s source time base (float maths here rounds 123 to 122).
            filters: ",setpts='if(lt(N,150),N,N+15)'",
            rate: "30",
            args: &["-c:v", "libx264", "-preset", "veryfast", "-bf", "3", "-g", "48", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", "-video_track_timescale", "30000"],
            time: vfr,
        },
        Clip { name: "prores.mov", filters: "", rate: "30", args: &["-c:v", "prores_ks", "-profile:v", "0", "-pix_fmt", "yuv422p10le"], time: cfr30 },
    ]
}

fn fixtures_dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            eprintln!("ffmpeg not found; skipping decode tests");
            return None;
        }
        let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("media-fixtures");
        std::fs::create_dir_all(&dir).unwrap();
        for c in clips() {
            make(&dir, &c);
        }
        let rotated = dir.join("rotated.mp4");
        if !rotated.exists() {
            let src = dir.join("h264_bframes.mp4");
            run(&["-display_rotation", "90", "-i", src.to_str().unwrap(), "-c", "copy", rotated.to_str().unwrap()]);
        }
        Some(dir)
    })
    .as_deref()
}

fn run(args: &[&str]) {
    let out = Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).output().expect("ffmpeg");
    assert!(out.status.success(), "ffmpeg {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

fn make(dir: &Path, c: &Clip) {
    let path = dir.join(c.name);
    if path.exists() {
        return;
    }
    let src = format!("color=c=black:s=640x128:r={},format=gray,{BARCODE}{},format=yuv420p", c.rate, c.filters);
    let frames = FRAMES.to_string();
    let mut args = vec!["-f", "lavfi", "-i", &src, "-frames:v", &frames];
    args.extend_from_slice(c.args);
    let tmp = dir.join(format!("tmp-{}", c.name));
    args.push(tmp.to_str().unwrap());
    run(&args);
    std::fs::rename(tmp, path).unwrap();
}

/// Read the barcode back.
fn frame_number(f: &VideoFrame) -> i64 {
    let img = f.to_rgb().unwrap();
    (0..10).map(|bit| ((img.pixel(bit * 64 + 32, 64)[0] > 128) as i64) << bit).sum()
}

/// Decoder set-ups to test: native VideoToolbox, VideoToolbox through FFmpeg, software.
#[derive(Copy, Clone, Debug)]
enum Mode {
    Native,
    FfmpegHw,
    Software,
}

fn modes() -> Vec<Mode> {
    if cfg!(target_os = "macos") {
        vec![Mode::Native, Mode::FfmpegHw, Mode::Software]
    } else {
        vec![Mode::Software]
    }
}

fn open_mode(path: &Path, mode: Mode) -> VideoDecoder {
    let opts = match mode {
        Mode::Native => DecoderOptions::default(),
        Mode::FfmpegHw => DecoderOptions { native_videotoolbox: false, ..Default::default() },
        Mode::Software => DecoderOptions { hardware: HardwareMode::Off, ..Default::default() },
    };
    VideoDecoder::open(path, &opts).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn open(path: &Path, hardware: HardwareMode) -> VideoDecoder {
    VideoDecoder::open(path, &DecoderOptions { hardware, ..Default::default() }).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn sequential_decode_returns_every_frame_in_order() {
    let Some(dir) = fixtures_dir() else { return };
    for c in clips() {
        for mode in modes() {
            let mut d = open_mode(&dir.join(c.name), mode);
            let mut n = 0;
            while let Some(f) = d.next_frame().unwrap() {
                assert_eq!(frame_number(&f), n, "{} {mode:?}: frame {n}", c.name);
                assert_eq!(f.time, (c.time)(n), "{} {mode:?}: time of frame {n}", c.name);
                n += 1;
            }
            assert_eq!(n, FRAMES, "{} {mode:?}: frame count", c.name);
        }
    }
}

/// Deterministic pseudo-random sequence.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: i64) -> i64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) % n as u64) as i64
    }
}

#[test]
fn random_access_is_frame_accurate() {
    let Some(dir) = fixtures_dir() else { return };
    for c in clips() {
        for mode in modes() {
            let mut d = open_mode(&dir.join(c.name), mode);
            let mut rng = Lcg(42);
            let mut n = 0;
            for step in 0..240 {
                // Mix far jumps, short hops forward and back, and frame-by-frame stepping.
                n = match step % 4 {
                    0 => rng.next(FRAMES),
                    1 => (n + 1 + rng.next(5)).min(FRAMES - 1),
                    2 => (n - 1 - rng.next(3)).max(0),
                    _ => (n + 1).min(FRAMES - 1),
                };
                let start = (c.time)(n);
                let end = if n + 1 < FRAMES { (c.time)(n + 1) } else { start + Micros(33_333) };
                let t = match rng.next(3) {
                    0 => start,
                    1 => Micros((start.0 + end.0) / 2),
                    _ => Micros(end.0 - 1),
                };
                let f = d.frame_at(t).unwrap_or_else(|e| panic!("{} {mode:?}: frame_at({}) step {step}: {e}", c.name, t.0)).unwrap();
                assert_eq!(frame_number(&f), n, "{} {mode:?}: frame_at({}) step {step}", c.name, t.0);
                assert_eq!(f.time, start, "{} {mode:?}: time at step {step}", c.name);
            }
        }
    }
}

#[test]
fn times_outside_the_stream_clamp_to_first_and_last_frames() {
    let Some(dir) = fixtures_dir() else { return };
    for c in clips() {
        let mut d = open(&dir.join(c.name), HardwareMode::Auto);
        let last = d.frame_at(Micros(3_600_000_000)).unwrap_or_else(|e| panic!("{}: {e}", c.name)).unwrap();
        assert_eq!(frame_number(&last), FRAMES - 1, "{}", c.name);
        let first = d.frame_at(Micros(-5)).unwrap().unwrap();
        assert_eq!(frame_number(&first), 0, "{}", c.name);
    }
}

#[test]
fn vfr_gap_shows_the_previous_frame() {
    let Some(dir) = fixtures_dir() else { return };
    let mut d = open(&dir.join("h264_vfr.mp4"), HardwareMode::Auto);
    for ms in [4_970, 5_100, 5_300, 5_465] {
        let f = d.frame_at(Micros(ms * 1000)).unwrap().unwrap();
        assert_eq!(frame_number(&f), 149, "at {ms} ms");
    }
    let f = d.frame_at(Micros(5_500_000)).unwrap().unwrap();
    assert_eq!(frame_number(&f), 150);
}

#[test]
fn probe_reports_stream_facts() {
    let Some(dir) = fixtures_dir() else { return };
    let v = probe(&dir.join("h264_2997.mp4")).unwrap().video.unwrap();
    assert_eq!((v.codec.as_str(), v.width, v.height, v.bit_depth), ("h264", 640, 128, 8));
    assert_eq!(v.frame_rate, Some(FrameRate::new(30000, 1001)));
    assert_eq!(v.frame_count, Some(FRAMES));
    let v = probe(&dir.join("hevc_10bit.mp4")).unwrap().video.unwrap();
    assert_eq!((v.codec.as_str(), v.bit_depth), ("hevc", 10));
    // `-display_rotation 90` asks for a 90° counter-clockwise turn, i.e. 270° clockwise.
    assert_eq!(probe(&dir.join("rotated.mp4")).unwrap().video.unwrap().rotation, 270);
    assert_eq!(probe(&dir.join("h264_bframes.mp4")).unwrap().video.unwrap().rotation, 0);
}

#[cfg(target_os = "macos")]
#[test]
fn hardware_frames_are_iosurface_backed_yuv() {
    let Some(dir) = fixtures_dir() else { return };
    for (name, format) in [("h264_bframes.mp4", PixelFormat::Nv12), ("hevc.mp4", PixelFormat::Nv12), ("hevc_10bit.mp4", PixelFormat::P010)] {
        let mut d = open(&dir.join(name), HardwareMode::Require);
        assert!(d.native_videotoolbox(), "{name}: expected the native VideoToolbox path");
        let f = d.frame_at(Micros(1_000_000)).unwrap().unwrap();
        assert!(f.is_hardware(), "{name}");
        assert_eq!(f.pixel_format(), format, "{name}");
        assert!(f.io_surface().is_some(), "{name}: no IOSurface");
        assert_eq!(frame_number(&f), 30, "{name}");
    }
}

#[test]
fn keyframe_index_lists_each_gop_start() {
    let Some(dir) = fixtures_dir() else { return };
    let d = open(&dir.join("h264_bframes.mp4"), HardwareMode::Auto);
    // A keyframe every 48 frames (index times are decode times here: B-frames put them
    // two frames early).
    let keys = d.keyframe_times();
    assert_eq!(keys.len(), 7);
    assert!(keys.windows(2).all(|w| w[1] - w[0] == cfr30(48)), "{keys:?}");
    for t in [Micros(0), cfr30(47), cfr30(48), cfr30(200), cfr30(299)] {
        assert_eq!(d.keyframe_time(t), keys.iter().rev().find(|k| **k <= t).copied(), "at {t:?}");
    }
    // Seeking to an index time can land in the GOP before; the middle of the GOP finds its
    // keyframe, whose own time maps back to the index time.
    let mut d = open(&dir.join("h264_bframes.mp4"), HardwareMode::Auto);
    for (i, w) in keys.windows(2).enumerate() {
        let f = d.keyframe_at(Micros((w[0].0 + w[1].0) / 2)).unwrap().unwrap();
        assert_eq!(frame_number(&f), 48 * i as i64);
        assert_eq!(d.keyframe_time(f.time), Some(w[0]));
    }
}

#[cfg(target_os = "macos")]
#[test]
fn shrunk_pictures_come_out_smaller() {
    let Some(dir) = fixtures_dir() else { return };
    for name in ["h264_bframes.mp4", "hevc.mp4"] {
        let mut d = VideoDecoder::open(&dir.join(name), &DecoderOptions { shrink_to: 320, ..Default::default() }).unwrap();
        let f = d.keyframe_at(cfr30(100)).unwrap().unwrap();
        assert_eq!((f.width(), f.height()), (320, 64), "{name}");
        // The barcode at half size: frame 96 is the GOP's keyframe.
        let img = f.to_rgb().unwrap();
        let n: i64 = (0..10).map(|bit| ((img.pixel(bit * 32 + 16, 32)[0] > 128) as i64) << bit).sum();
        assert_eq!(n, 96, "{name}");
        assert_eq!(f.time, cfr30(96), "{name}");
    }
}

#[test]
fn stepping_backward_is_exact_and_mostly_cached() {
    let Some(dir) = fixtures_dir() else { return };
    for c in clips() {
        for mode in modes() {
            let mut d = open_mode(&dir.join(c.name), mode);
            for n in (0..FRAMES).rev() {
                let f = d.frame_at((c.time)(n)).unwrap().unwrap();
                assert_eq!(frame_number(&f), n, "{} {mode:?}: stepping back to frame {n}", c.name);
            }
            // One decode per GOP (48 frames) at most; every other step comes from the cache.
            // (Intra-only ProRes needs no cache: each step decodes just the frame itself.)
            let s = d.stats();
            if c.name != "prores.mov" {
                assert!(s.cache_hits as i64 >= FRAMES * 3 / 4, "{} {mode:?}: only {} cache hits", c.name, s.cache_hits);
            }
        }
    }
}

#[test]
fn reading_backward_shows_every_frame_exactly() {
    let Some(dir) = fixtures_dir() else { return };
    for c in clips() {
        for mode in modes() {
            let opts = match mode {
                Mode::Native => DecoderOptions::default(),
                Mode::FfmpegHw => DecoderOptions { native_videotoolbox: false, ..Default::default() },
                Mode::Software => DecoderOptions { hardware: HardwareMode::Off, ..Default::default() },
            };
            // Room for 10 frames a window (a GOP is 48: windows inside GOPs), and for every
            // frame (windows from keyframe to keyframe).
            let frame_bytes = 640 * 128 * 3 / 2 * if c.name.contains("10bit") || c.name.contains("prores") { 2 } else { 1 };
            for budget in [10 * frame_bytes, 1 << 30] {
                let mut r = ReverseReader::open(&dir.join(c.name), &opts, budget).unwrap();
                let mut rng = Lcg(7);
                for n in (0..FRAMES).rev() {
                    let start = (c.time)(n);
                    let end = if n + 1 < FRAMES { (c.time)(n + 1) } else { start + Micros(33_333) };
                    // Anywhere inside the frame: the playhead lands between frames.
                    let t = Micros(start.0 + rng.next(end.0 - start.0));
                    let f = r.frame_at(t).unwrap_or_else(|e| panic!("{} {mode:?}: {e}", c.name)).unwrap();
                    assert_eq!(frame_number(&f), n, "{} {mode:?} budget {budget}: back to frame {n}", c.name);
                    assert_eq!(f.time, start, "{} {mode:?}: time of frame {n}", c.name);
                }
                let s = r.stats();
                // Each frame kept once (plus the frame shown at each window's start).
                assert!(s.frames as i64 <= FRAMES + s.windows as i64, "{} {mode:?}: {s:?}", c.name);
                assert!(s.waits <= s.windows, "{} {mode:?}: {s:?}", c.name);
            }
        }
    }
}

#[test]
fn reading_backward_agrees_with_seeking() {
    // Jumps up, then backward in hops: the same frame as a decoder's `frame_at`.
    let Some(dir) = fixtures_dir() else { return };
    for c in clips() {
        let path = dir.join(c.name);
        let mut seek = open(&path, HardwareMode::Auto);
        let mut r = ReverseReader::open(&path, &DecoderOptions::default(), 8 * 640 * 128 * 3).unwrap();
        let mut rng = Lcg(3);
        let mut t = Micros(9_000_000);
        for step in 0..200 {
            t = match step % 25 {
                0 => Micros(rng.next(10_000_000)),
                _ => Micros((t.0 - 1 - rng.next(70_000)).max(0)),
            };
            let a = r.frame_at(t).unwrap().unwrap();
            let b = seek.frame_at(t).unwrap().unwrap();
            assert_eq!((frame_number(&a), a.time), (frame_number(&b), b.time), "{} at {t:?} (step {step})", c.name);
        }
    }
}
