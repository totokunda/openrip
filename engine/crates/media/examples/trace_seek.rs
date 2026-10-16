//! Print what frame_at returns for a list of times: `trace_seek <file> <hw|sw> <secs>...`
use openrip_media::{DecoderOptions, HardwareMode, Micros, VideoDecoder};
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let hw = if a[1] == "sw" { HardwareMode::Off } else { HardwareMode::Auto };
    let mut d = VideoDecoder::open(a[0].as_ref(), &DecoderOptions { hardware: hw, ..Default::default() }).unwrap();
    for t in &a[2..] {
        let t = Micros::from_secs_f64(t.parse().unwrap());
        let before = d.stats();
        let f = d.frame_at(t).unwrap().unwrap();
        let img = f.to_rgb().unwrap();
        let n: i64 = (0..10).map(|b| ((img.pixel(b * 64 + 32, 64)[0] > 128) as i64) << b).sum();
        let s = d.stats();
        println!("t={:>9} -> time {:>9} barcode {n:>3} (decoded {}, seeks {})", t.0, f.time.0, s.frames_decoded - before.frames_decoded, s.seeks - before.seeks);
    }
}
