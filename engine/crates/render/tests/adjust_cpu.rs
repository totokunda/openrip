//! The Adjust sliders' CPU reference (`Adjust::apply_rgb`, what Auto adjust solves against)
//! draws what the GPU pass draws. Skipped when no GPU adapter is available.

use openrip_render::{Adjust, Compositor, Layer, RgbaImage};

const W: u32 = 64;
const H: u32 = 64;

/// Colours across the cube: red across, green down, blue in steps along the diagonal.
fn colours() -> RgbaImage {
    let mut data = Vec::with_capacity((W * H * 4) as usize);
    for y in 0..H {
        for x in 0..W {
            data.extend_from_slice(&[(x * 4 + 2) as u8, (y * 4 + 2) as u8, (((x / 8 + y / 8) * 16) % 256) as u8, 255]);
        }
    }
    RgbaImage { width: W, height: H, data }
}

#[test]
fn the_cpu_reference_matches_the_gpu() {
    let Ok(c) = Compositor::new() else {
        eprintln!("no GPU; skipping");
        return;
    };
    let img = colours();
    let cases = [
        Adjust { brightness: 0.3, ..Default::default() },
        Adjust { brightness: -0.4, ..Default::default() },
        Adjust { contrast: 0.5, ..Default::default() },
        Adjust { contrast: -0.35, ..Default::default() },
        Adjust { saturation: 0.4, ..Default::default() },
        Adjust { highlights: -0.5, shadows: 0.4, ..Default::default() },
        Adjust { whites: 0.3, blacks: -0.2, ..Default::default() },
        Adjust { temperature: 0.4, tint: -0.3, ..Default::default() },
        Adjust { brightness: 0.12, contrast: 0.2, saturation: 0.3, temperature: -0.2, tint: 0.1, whites: 0.2, blacks: -0.1, ..Default::default() },
    ];
    for a in cases {
        let out = c.render(W, H, [0, 0, 0], &[Layer { adjust: Some((a.clone(), None)), ..Layer::from_model(&img, [W, H], [0.0, 0.0], [1.0, 1.0], 0.0) }]);
        let mut worst = 0.0f32;
        for i in 0..(W * H) as usize {
            let src = [0, 1, 2].map(|k| img.data[i * 4 + k] as f32 / 255.0);
            let want = a.apply_rgb(src);
            for k in 0..3 {
                worst = worst.max((out.data[i * 4 + k] as f32 / 255.0 - want[k]).abs());
            }
        }
        // The GPU works in 8-bit stages; a level or two apart.
        assert!(worst <= 2.5 / 255.0, "{a:?}: {:.2} levels apart", worst * 255.0);
    }
}
