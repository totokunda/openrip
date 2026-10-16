//! After seeking to each given time, print the barcodes of the next frames: `trace_seq <file> <hw|sw> <count> <secs>...`
use openrip_media::{DecoderOptions, HardwareMode, Micros, VideoDecoder};
fn code(f: &openrip_media::VideoFrame) -> i64 {
    let img = f.to_rgb().unwrap();
    (0..10).map(|b| ((img.pixel(b * 64 + 32, 64)[0] > 128) as i64) << b).sum()
}
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let hw = if a[1] == "sw" { HardwareMode::Off } else { HardwareMode::Auto };
    let count: usize = a[2].parse().unwrap();
    let mut d = VideoDecoder::open(a[0].as_ref(), &DecoderOptions { hardware: hw, ..Default::default() }).unwrap();
    for t in &a[3..] {
        let f = d.frame_at(Micros::from_secs_f64(t.parse().unwrap())).unwrap().unwrap();
        let mut line = format!("seek {t}: [{} @{}]", code(&f), f.time.0 / 33333);
        for _ in 0..count {
            let f = d.next_frame().unwrap().unwrap();
            line += &format!(" {}@{}", code(&f), (f.time.0 as f64 / 33333.33).round());
        }
        println!("{line}");
    }
}
