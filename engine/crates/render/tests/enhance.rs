//! A clip's clean-up on the GPU (Reduce image noise, Motion blur, Remove flickers): noise
//! drops without smearing motion, the blur is the average of the frames around, the gain is
//! the gain. Skipped when no GPU adapter is available.

use openrip_motion::testing::{psnr, render_square, texture, Rng};
use openrip_motion::Gray;
use openrip_render::{Compositor, Enhance, Layer, Picture, RgbaImage, Source};

fn gpu() -> Option<Compositor> {
    match Compositor::new() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("no GPU ({e}); skipping");
            None
        }
    }
}

const W: usize = 240;
const H: usize = 180;

/// A textured square over a textured background at frame `k`, moving 6 px a frame.
fn scene(k: f64) -> Gray {
    let mut rng = Rng(21);
    let background = texture(&mut rng, W, H, 2.5);
    let object = texture(&mut rng, 80, 80, 2.0);
    render_square(&background, &object, W, H, [90.0 + 6.0 * k, 80.0], 70.0, 0.0)
}

/// A still scene (the same at every frame).
fn still() -> Gray {
    scene(0.0)
}

fn rgba(g: &Gray) -> RgbaImage {
    RgbaImage { width: W as u32, height: H as u32, data: g.data.iter().flat_map(|v| [(v.clamp(0.0, 1.0) * 255.0).round() as u8; 3].into_iter().chain([255])).collect() }
}

/// `g` with independent noise (about `sd` standard deviation, from the sum of three uniforms).
fn noisy(g: &Gray, rng: &mut Rng, sd: f32) -> Gray {
    let mut out = g.clone();
    for v in out.data.iter_mut() {
        let n = (rng.unit() + rng.unit() + rng.unit() - 1.5) * 2.0;
        *v = (*v + n as f32 * sd).clamp(0.0, 1.0);
    }
    out
}

fn gray(img: &RgbaImage) -> Vec<f32> {
    Gray::from_rgba(img.width as usize, img.height as usize, &img.data).data
}

fn draw(c: &Compositor, cur: &RgbaImage, prev: Option<&RgbaImage>, next: Option<&RgbaImage>, denoise: f32, blur: f32, gain: f32) -> RgbaImage {
    let enhance = Enhance { prev: prev.map(Picture::Image), next: next.map(Picture::Image), denoise, blur, gain };
    let layer = Layer { enhance: Some(enhance), ..Layer::placed(Source::Image(cur), [W as f64 / 2.0, H as f64 / 2.0], [W as f64, H as f64]) };
    c.render(W as u32, H as u32, [0, 0, 0], &[layer])
}

#[test]
fn noise_drops_on_a_still_scene() {
    let Some(c) = gpu() else { return };
    let clean = still();
    let mut rng = Rng(5);
    let frames: Vec<RgbaImage> = (0..3).map(|_| rgba(&noisy(&clean, &mut rng, 0.05))).collect();
    let truth = gray(&rgba(&clean));
    let before = psnr(&gray(&frames[1]), &truth);
    let out = draw(&c, &frames[1], Some(&frames[0]), Some(&frames[2]), 0.6, 0.0, 1.0);
    let after = psnr(&gray(&out), &truth);
    eprintln!("still scene: {before:.1} dB noisy, {after:.1} dB denoised");
    assert!(after > before + 3.0, "{before:.1} -> {after:.1}");
    // The first frame of a clip has no frame before: the spatial filter still helps.
    let first = draw(&c, &frames[0], None, Some(&frames[1]), 0.6, 0.0, 1.0);
    assert!(psnr(&gray(&first), &truth) > psnr(&gray(&frames[0]), &truth) + 2.0);
}

#[test]
fn motion_is_not_smeared_by_denoising() {
    let Some(c) = gpu() else { return };
    let mut rng = Rng(9);
    let clean: Vec<Gray> = (0..3).map(|k| scene(k as f64)).collect();
    let frames: Vec<RgbaImage> = clean.iter().map(|g| rgba(&noisy(g, &mut rng, 0.04))).collect();
    let truth = gray(&rgba(&clean[1]));
    let before = psnr(&gray(&frames[1]), &truth);
    let out = draw(&c, &frames[1], Some(&frames[0]), Some(&frames[2]), 0.6, 0.0, 1.0);
    let after = psnr(&gray(&out), &truth);
    eprintln!("moving scene: {before:.1} dB noisy, {after:.1} dB denoised");
    // No ghost of the square at its neighbours' positions: still better than the noisy frame.
    assert!(after > before + 1.0, "{before:.1} -> {after:.1}");
}

#[test]
fn nothing_on_changes_nothing() {
    let Some(c) = gpu() else { return };
    let img = rgba(&scene(1.0));
    let (a, b) = (rgba(&scene(0.0)), rgba(&scene(2.0)));
    let out = draw(&c, &img, Some(&a), Some(&b), 0.0, 0.0, 1.0);
    assert_eq!(out.data, img.data);
}

#[test]
fn motion_blur_averages_the_frames_around() {
    let Some(c) = gpu() else { return };
    let (a, b, d) = (rgba(&scene(0.0)), rgba(&scene(1.0)), rgba(&scene(2.0)));
    // Full amount: a third of each.
    let out = gray(&draw(&c, &b, Some(&a), Some(&d), 0.0, 1.0, 1.0));
    let mean: Vec<f32> = gray(&a).iter().zip(gray(&b)).zip(gray(&d)).map(|((x, y), z)| (x + y + z) / 3.0).collect();
    assert!(psnr(&out, &mean) > 40.0, "{:.1} dB from the three-frame average", psnr(&out, &mean));
    // Half: between the frame and that.
    let half = gray(&draw(&c, &b, Some(&a), Some(&d), 0.0, 0.5, 1.0));
    let (lo, hi) = (psnr(&half, &gray(&b)), psnr(&half, &mean));
    assert!(lo > 20.0 && hi > 20.0 && (psnr(&half, &gray(&b)) - psnr(&out, &gray(&b))).abs() > 1.0, "{lo:.1} / {hi:.1}");
    // With no neighbours it has nothing to blend.
    let alone = draw(&c, &rgba(&scene(1.0)), None, None, 0.0, 1.0, 1.0);
    assert!(psnr(&gray(&alone), &gray(&b)) > 45.0);
}

#[test]
fn the_flicker_gain_scales_brightness() {
    let Some(c) = gpu() else { return };
    let img = rgba(&scene(0.0));
    let mean = |i: &RgbaImage| gray(i).iter().sum::<f32>() / (W * H) as f32;
    let (m0, m1, m2) = (mean(&img), mean(&draw(&c, &img, None, None, 0.0, 0.0, 0.8)), mean(&draw(&c, &img, None, None, 0.0, 0.0, 1.2)));
    assert!((m1 / m0 - 0.8).abs() < 0.01 && (m2 / m0 - 1.2).abs() < 0.02, "{m0} {m1} {m2}");
}
