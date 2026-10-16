//! Frame server behaviour on a barcoded clip (frame number encoded in 64-px blocks), made
//! with the `ffmpeg` CLI (tests skip without it).

use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use openrip_media::{DecoderOptions, FrameRate, Micros, VideoFrame};
use openrip_playback::{Delivered, FrameServer, Quality, SeekMode};

const FRAMES: i64 = 300;

fn clip() -> Option<PathBuf> {
    static CLIP: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    CLIP.get_or_init(make_clip).clone()
}

fn make_clip() -> Option<PathBuf> {
    if Command::new("ffmpeg").arg("-version").output().is_err() {
        eprintln!("ffmpeg not found; skipping");
        return None;
    }
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let path = dir.join("playback-barcode.mp4");
    if !path.exists() {
        let tmp = dir.join("playback-barcode.tmp.mp4");
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg("color=c=black:s=640x128:r=30,format=gray,geq=lum='255*mod(floor(N/pow(2,floor(X/64))),2)',format=yuv420p")
            .args(["-frames:v", &FRAMES.to_string(), "-c:v", "libx264", "-preset", "veryfast", "-bf", "3", "-g", "48", "-pix_fmt", "yuv420p"])
            .arg(&tmp)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        std::fs::rename(tmp, &path).unwrap();
    }
    Some(path)
}

fn number(f: &VideoFrame) -> i64 {
    let img = f.to_rgb().unwrap();
    (0..10).map(|bit| ((img.pixel(bit * 64 + 32, 64)[0] > 128) as i64) << bit).sum()
}

fn at(n: i64) -> Micros {
    FrameRate::new(30, 1).frame_start(n)
}

fn server() -> Option<(FrameServer, mpsc::Receiver<Delivered>)> {
    let path = clip()?;
    let (tx, rx) = mpsc::channel();
    let s = FrameServer::open(&path, &DecoderOptions::default(), move |d| {
        let _ = tx.send(d);
    })
    .unwrap();
    Some((s, rx))
}

#[test]
fn accurate_requests_return_the_exact_frame() {
    let Some((s, rx)) = server() else { return };
    for n in [0, 150, 151, 37, 299, 120] {
        let id = s.request(at(n), SeekMode::Accurate);
        let d = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(d.request, id);
        let (f, q) = d.result.unwrap();
        assert_eq!((number(&f), q), (n, Quality::Exact));
    }
}

#[test]
fn newest_request_wins() {
    let Some((s, rx)) = server() else { return };
    // A burst far faster than decoding: stale requests must be dropped, not queued.
    let mut last = 0;
    for n in (0..FRAMES).step_by(3) {
        last = s.request(at(n), SeekMode::Accurate);
    }
    s.wait_idle();
    let answers: Vec<Delivered> = rx.try_iter().collect();
    let final_answer = answers.last().unwrap();
    assert_eq!(final_answer.request, last);
    assert_eq!(number(&final_answer.result.as_ref().unwrap().0), 297);
    let st = s.stats();
    assert_eq!(st.requested, 100);
    assert!(st.superseded >= 90, "only {} of 100 superseded", st.superseded);
    assert_eq!(answers.len() as u64, st.requested - st.superseded);
}

#[test]
fn scrub_answers_within_tolerance_then_accurate_is_exact() {
    let Some((s, rx)) = server() else { return };
    let tolerance = Micros(500_000);
    for n in [10, 100, 200, 250] {
        s.request(at(n), SeekMode::Scrub { tolerance });
        let (f, q) = rx.recv_timeout(Duration::from_secs(5)).unwrap().result.unwrap();
        let got = number(&f);
        assert!((at(got).0 - at(n).0).abs() <= tolerance.0, "scrub to {n} gave frame {got}");
        if q == Quality::Exact {
            assert_eq!(got, n);
        }
    }
    // Drag released: one accurate request lands exactly.
    s.request(at(250), SeekMode::Accurate);
    let (f, q) = rx.recv_timeout(Duration::from_secs(5)).unwrap().result.unwrap();
    assert_eq!((number(&f), q), (250, Quality::Exact));
}
