//! Does a video's frame go to the GPU without a copy? `import_check <video>`
use openrip_media::{DecoderOptions, VideoDecoder};
use openrip_render::{Compositor, Layer, Source};
use std::time::Instant;
fn main() {
    let path = std::env::args().nth(1).unwrap();
    let mut d = VideoDecoder::open(path.as_ref(), &DecoderOptions::default()).unwrap();
    let f = d.next_frame().unwrap().unwrap();
    let pb = f.pixel_buffer().unwrap();
    println!("frame {}x{} {:?}; plane 0 {}x{} stride {}; plane 1 {}x{} stride {}", f.width(), f.height(), f.pixel_format(),
        objc2_core_video::CVPixelBufferGetWidthOfPlane(pb, 0), objc2_core_video::CVPixelBufferGetHeightOfPlane(pb, 0), objc2_core_video::CVPixelBufferGetBytesPerRowOfPlane(pb, 0),
        objc2_core_video::CVPixelBufferGetWidthOfPlane(pb, 1), objc2_core_video::CVPixelBufferGetHeightOfPlane(pb, 1), objc2_core_video::CVPixelBufferGetBytesPerRowOfPlane(pb, 1));
    let c = Compositor::new().unwrap();
    println!("zero-copy import: {}", c.can_import(&f));
    for _ in 0..3 {
        let t0 = Instant::now();
        c.render(540, 940, [0, 0, 0], &[Layer::from_model(Source::Video(&f), [540, 940], [0.0, 0.0], [1.0, 1.0], 0.0)]);
        println!("render {:.1} ms", t0.elapsed().as_secs_f64() * 1e3);
    }
}
