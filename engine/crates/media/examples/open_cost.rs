//! Time opening the same file repeatedly: `open_cost <file> [--warm]`
use std::time::Instant;
use openrip_media::{DecoderOptions, VideoDecoder};
fn main() {
    let path = std::env::args().nth(1).unwrap();
    if std::env::args().any(|a| a == "--warm") {
        let t0 = Instant::now();
        openrip_media::warm_up().join().unwrap();
        println!("warm_up {:.1} ms", t0.elapsed().as_secs_f64() * 1e3);
    }
    for native in [true, false] {
        for i in 0..4 {
            let t0 = Instant::now();
            let mut d = VideoDecoder::open(path.as_ref(), &DecoderOptions { native_videotoolbox: native, ..Default::default() }).unwrap();
            let open = t0.elapsed().as_secs_f64() * 1e3;
            d.next_frame().unwrap();
            let first = t0.elapsed().as_secs_f64() * 1e3;
            println!("native={native} #{i}: open {open:6.1} ms, open+first frame {first:6.1} ms");
        }
    }
}
