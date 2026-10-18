//! The analysis API on a still (PNG, read without FFmpeg): its colour statistics, seen through
//! a look, and Auto adjust's sliders. Skipped without a GPU (frames are shrunk on it).

use openrip_core::{auto_adjust, color_stats, Adjust, AnalysisControl, Look, MatchOn, Micros};

fn write_png(path: &std::path::Path, w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 3]) {
    let mut data = Vec::with_capacity((w * h * 3) as usize);
    for y in 0..h {
        for x in 0..w {
            data.extend_from_slice(&f(x, y));
        }
    }
    let file = std::fs::File::create(path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgb);
    enc.write_header().unwrap().write_image_data(&data).unwrap();
}

#[test]
fn statistics_through_a_look_and_auto_adjust_on_a_still() {
    if openrip_render::Compositor::new().is_err() {
        eprintln!("no GPU; skipping");
        return;
    }
    let dir = std::env::temp_dir().join(format!("openrip-analysis-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    // A dim, bluish picture with a range of levels and colours.
    let dim = dir.join("dim.png");
    write_png(&dim, 160, 90, |x, y| {
        let v = 20 + (y * 90 / 90) as u8;
        [v + (x % 40) as u8 / 2, v + (x % 30) as u8 / 2, v + 25 + (x % 20) as u8]
    });
    let control = AnalysisControl::new();
    let plain = color_stats(&dim, Micros::ZERO, None, None, &control).unwrap();
    assert!(plain.pixels > 1000 && plain.lab.mean[0] < 0.45, "{plain:?}");
    assert_eq!(control.progress(), (1, 1));

    // Seen through brighter sliders, it's lighter.
    let brighter = Look { matched: None, sliders: Adjust { brightness: 0.5, ..Default::default() } };
    let lit = color_stats(&dim, Micros::ZERO, None, Some(&brighter), &control).unwrap();
    assert!(lit.lab.mean[0] > plain.lab.mean[0] + 0.05, "{} -> {}", plain.lab.mean[0], lit.lab.mean[0]);

    // Through a match to brighter, warmer statistics, they come close to those.
    let mut target = plain.lab;
    target.mean = [0.65, 0.01, 0.03];
    let matched = Look { matched: Some(MatchOn { source: plain.lab, reference: target, intensity: 1.0 }), sliders: Adjust::default() };
    let m = color_stats(&dim, Micros::ZERO, None, Some(&matched), &control).unwrap();
    for c in 0..3 {
        assert!((m.lab.mean[c] - target.mean[c]).abs() < 0.02, "channel {c}: {} vs {}", m.lab.mean[c], target.mean[c]);
    }

    // Auto adjust brightens it and warms it.
    let auto = auto_adjust(&dim, Micros::ZERO, None, None, &control).unwrap();
    assert!(auto.sliders.brightness > 0.0 || auto.sliders.whites > 0.0, "{:?}", auto.sliders);
    assert!(auto.sliders.temperature > 0.0, "{:?}", auto.sliders);

    std::fs::remove_dir_all(&dir).ok();
}
