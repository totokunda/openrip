//! Decode a few frames on the native path and print counters: `native_probe <file>`
use openrip_media::{DecoderOptions, VideoDecoder};
fn main() {
    let path = std::env::args().nth(1).unwrap();
    let mut d = VideoDecoder::open(path.as_ref(), &DecoderOptions::default()).unwrap();
    println!("native: {}", d.native_videotoolbox());
    for _ in 0..5 {
        match d.next_frame().unwrap() {
            Some(f) => println!("{f:?}"),
            None => { println!("no frame"); break }
        }
    }
    println!("{:?}", d.stats());
}
