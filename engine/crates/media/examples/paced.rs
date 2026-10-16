//! Decode at playback pace and time each frame: `paced <video> <fps> <seconds> [start]`
use openrip_media::{DecoderOptions, Micros, VideoDecoder};
use std::time::{Duration, Instant};
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let fps: f64 = a[1].parse().unwrap();
    let secs: f64 = a[2].parse().unwrap();
    let start: f64 = a.get(3).map(|s| s.parse().unwrap()).unwrap_or(0.0);
    let mut d = VideoDecoder::open(a[0].as_ref(), &DecoderOptions::default()).unwrap();
    d.frame_at(Micros::from_secs_f64(start)).unwrap();
    let t0 = Instant::now();
    let mut ms = Vec::new();
    let n = (secs * fps) as usize;
    for i in 1..n {
        let due = Duration::from_secs_f64(i as f64 / fps);
        std::thread::sleep(due.saturating_sub(t0.elapsed()));
        let s = Instant::now();
        d.frame_at(Micros::from_secs_f64(start + i as f64 / fps)).unwrap();
        let e = s.elapsed().as_secs_f64() * 1e3;
        if e > 20.0 { println!("frame {i}: {e:.1} ms  stats {:?}", d.stats()); }
        ms.push(e);
    }
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("paced {fps} fps: p50 {:.2} ms p95 {:.2} ms max {:.1} ms", ms[ms.len() / 2], ms[ms.len() * 95 / 100], ms[ms.len() - 1]);
}
