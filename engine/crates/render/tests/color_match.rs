//! Adjust ▸ Color match's table on a clip, in the compositor's frames. Skipped when no GPU
//! adapter is available.

use openrip_render::{Compositor, Layer, Lut3d, RgbaImage};

const W: u32 = 64;
const H: u32 = 32;

fn table(n: u32, f: &dyn Fn([f32; 3]) -> [f32; 3], key: u64) -> Lut3d {
    Lut3d { key, size: n, edge_aligned: true, rgb: (0..n * n * n).flat_map(|i| f([i % n, i / n % n, i / (n * n)].map(|v| v as f32 / (n - 1) as f32))).collect() }
}

fn px(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * img.width + x) * 4) as usize;
    img.data[i..i + 4].try_into().unwrap()
}

/// The match's table goes on before the clip's LUT, each mixed by its own strength.
#[test]
fn color_match_goes_before_the_clips_lut() {
    let Ok(c) = Compositor::new() else {
        eprintln!("no GPU; skipping");
        return;
    };
    // Two that don't commute: red squared (the match), then red and blue swapped (the LUT).
    let square = table(33, &|c| [c[0] * c[0], c[1], c[2]], 31);
    let swap = table(2, &|c| [c[2], c[1], c[0]], 32);
    let mut data = Vec::new();
    for y in 0..H {
        for x in 0..W {
            data.extend_from_slice(&[(x * 4) as u8, 120, (y * 8) as u8, 255]);
        }
    }
    let img = RgbaImage { width: W, height: H, data };
    let draw = |m: f32| c.render(W, H, [0, 0, 0], &[Layer { match_lut: Some((&square, m)), lut: Some((&swap, 1.0)), ..Layer::from_model(&img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0) }]);
    let (full, off) = (draw(1.0), draw(0.0));
    for (x, y) in [(10, 5), (40, 20), (63, 31)] {
        let p = px(&img, x, y).map(|v| v as f32 / 255.0);
        let want = [p[2], p[1], p[0] * p[0]].map(|v| (v * 255.0).round() as i32);
        let got = px(&full, x, y);
        assert!((0..3).all(|k| (got[k] as i32 - want[k]).abs() <= 2), "{got:?} vs {want:?}");
        // With the match at 0, only the swap.
        let plain = px(&off, x, y);
        assert_eq!([plain[0], plain[2]], [px(&img, x, y)[2], px(&img, x, y)[0]]);
    }
}
