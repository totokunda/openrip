//! Frames made in between two others on the GPU (Smooth slow-mo, Optical flow): the flow
//! matches openrip-motion's CPU reference, and a held-out middle frame is reconstructed much
//! better than by blending. Skipped when no GPU adapter is available.

use openrip_motion::flow::{dense_flow, FlowOptions};
use openrip_motion::testing::{psnr, render_square, texture, Rng};
use openrip_motion::Gray;
use openrip_render::{Compositor, Layer, Picture, RgbaImage, Source, Tween, TweenMode};

fn gpu() -> Option<Compositor> {
    match Compositor::new() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("no GPU ({e}); skipping");
            None
        }
    }
}

/// A textured square over a textured background at frame `k`: 9 px a frame right and 4 down
/// (at 240×180; scaled with the size), turning 2° a frame.
fn scene(k: f64, w: usize, h: usize) -> Gray {
    let mut rng = Rng(21);
    let background = texture(&mut rng, 240, 180, 2.5);
    let object = texture(&mut rng, 80, 80, 2.0);
    let s = w as f64 / 240.0;
    render_square(&background, &object, w, h, [(90.0 + 9.0 * k) * s, (80.0 + 4.0 * k) * s], 70.0 * s, (2.0 * k).to_radians())
}

fn rgba(g: &Gray) -> RgbaImage {
    RgbaImage { width: g.width as u32, height: g.height as u32, data: g.data.iter().flat_map(|v| [(v * 255.0).round() as u8; 3].into_iter().chain([255])).collect() }
}

fn gray(img: &RgbaImage) -> Vec<f32> {
    Gray::from_rgba(img.width as usize, img.height as usize, &img.data).data
}

fn tween(c: &Compositor, a: &RgbaImage, b: &RgbaImage, t: f32, mode: TweenMode) -> RgbaImage {
    let tw = Tween { from: Picture::Image(a), to: Picture::Image(b), t, key: 42 + mode as u64 + 10 * a.width as u64, mode };
    let (w, h) = (a.width, a.height);
    c.render(w, h, [0, 0, 0], &[Layer::placed(Source::Tween(tw), [w as f64 / 2.0, h as f64 / 2.0], [w as f64, h as f64])])
}

#[test]
fn gpu_flow_matches_the_cpu_reference() {
    let Some(c) = gpu() else { return };
    let (a, b) = (rgba(&scene(0.0, 240, 180)), rgba(&scene(1.0, 240, 180)));
    let field = c.optical_flow(&a, &b);
    assert_eq!((field.width, field.height, field.factor), (240, 180, 1));
    let cpu = dense_flow(&Gray::from_rgba(240, 180, &a.data), &Gray::from_rgba(240, 180, &b.data), &FlowOptions::default());
    let mut diffs: Vec<f32> = (0..cpu.u.len()).map(|i| (field.uv[i][0] - cpu.u[i]).hypot(field.uv[i][1] - cpu.v[i])).collect();
    diffs.sort_by(f32::total_cmp);
    let (median, p95) = (diffs[diffs.len() / 2], diffs[diffs.len() * 95 / 100]);
    eprintln!("GPU against CPU flow: median {median:.4} px, 95th percentile {p95:.4} px");
    assert!(median < 0.01 && p95 < 0.25, "median {median}, p95 {p95}");
    // And it found the square's motion at its centre.
    let centre = field.uv[80 * 240 + 90];
    assert!((centre[0] - 9.0).abs() < 0.3 && (centre[1] - 4.0).abs() < 0.3, "{centre:?}");
}

#[test]
fn a_held_out_middle_frame_is_rebuilt_better_than_by_blending() {
    let Some(c) = gpu() else { return };
    // At 240×180 (flow at full size) and at 1200×900 (flow at half size, 600×450).
    for (w, h) in [(240usize, 180usize), (1200, 900)] {
        let (a, mid, b) = (rgba(&scene(0.0, w, h)), rgba(&scene(1.0, w, h)), rgba(&scene(2.0, w, h)));
        let truth = gray(&mid);
        let flow = psnr(&gray(&tween(&c, &a, &b, 0.5, TweenMode::Flow)), &truth);
        let blend = psnr(&gray(&tween(&c, &a, &b, 0.5, TweenMode::Blend)), &truth);
        eprintln!("{w}x{h}: held-out middle frame {flow:.2} dB by flow, {blend:.2} dB by blending");
        assert!(flow > blend + 5.0, "{w}x{h}: flow {flow:.2} dB, blend {blend:.2} dB");
        // The ends are the frames themselves.
        let start = tween(&c, &a, &b, 0.0, TweenMode::Flow);
        assert!(psnr(&gray(&start), &gray(&a)) > 40.0);
    }
}

/// How long the flow and the in-between frames take at 4K (run with --ignored --nocapture).
#[test]
#[ignore]
fn timing_at_4k() {
    let Some(c) = gpu() else { return };
    let (w, h) = (3840usize, 2160usize);
    let a = rgba(&scene(0.0, w, h));
    let b = rgba(&scene(1.0, w, h));
    for (i, t) in [0.25f32, 0.5, 0.75, 0.25, 0.5].into_iter().enumerate() {
        let t0 = std::time::Instant::now();
        let tw = Tween { from: Picture::Image(&a), to: Picture::Image(&b), t, key: 7, mode: TweenMode::Flow };
        // Rendered small, as the preview does, so readback doesn't dominate.
        let _ = c.render(960, 540, [0, 0, 0], &[Layer::placed(Source::Tween(tw), [480.0, 270.0], [960.0, 540.0])]);
        eprintln!("frame {i} (t {t}): {:.1} ms{}", t0.elapsed().as_secs_f64() * 1e3, if i == 0 { " (flow worked out)" } else { "" });
    }
}

/// How long the flow takes from 4K frames (run with --ignored --nocapture).
#[test]
#[ignore]
fn flow_timing_at_4k() {
    let Some(c) = gpu() else { return };
    let (w, h) = (3840usize, 2160usize);
    let a = rgba(&scene(0.0, w, h));
    let b = rgba(&scene(1.0, w, h));
    for i in 0..12 {
        let t0 = std::time::Instant::now();
        let f = c.optical_flow(&a, &b);
        eprintln!("flow {i}: {}x{} in {:.1} ms (uploads and one direction)", f.width, f.height, t0.elapsed().as_secs_f64() * 1e3);
    }
}
