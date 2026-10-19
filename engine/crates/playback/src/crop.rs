//! A clip's crop: the rectangle of its picture the clip shows (the app's Crop dialog).
//!
//! The crop is drawn as a cut-out over the whole picture (a matte, like a mask) with the
//! picture placed so the rectangle lands where the clip's box is: the clip's transform
//! describes the rectangle (its size and its centre), as the app keeps it. A rectangle turned
//! by `rotation` straightens the picture: the clip shows the rectangle upright, so the picture
//! inside it is turned the same number of degrees clockwise.

use openrip_model::CropRect;

/// Coverage (0 outside, 255 inside, soft across the edge) of the crop over an upright picture
/// of `size` pixels, sampled on a `w`×`h` grid.
pub fn coverage(c: &CropRect, size: (u32, u32), w: u32, h: u32) -> Vec<u8> {
    let (sw, sh) = (size.0.max(1) as f64, size.1.max(1) as f64);
    let centre = ((c.x + c.width / 2.0) * sw, (c.y + c.height / 2.0) * sh);
    let half = (c.width * sw / 2.0, c.height * sh / 2.0);
    let (sin, cos) = c.rotation.to_radians().sin_cos();
    // Source pixels per mask pixel.
    let (kx, ky) = (sw / w as f64, sh / h as f64);
    let reach = (kx.max(ky)).max(1e-9);
    let mut out = vec![0u8; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            let (px, py) = ((x as f64 + 0.5) * kx - centre.0, (y as f64 + 0.5) * ky - centre.1);
            // The picture turned clockwise by the rotation, as it's shown: the rectangle is
            // upright there.
            let (qx, qy) = (cos * px - sin * py, sin * px + cos * py);
            let ax = ((half.0 - qx.abs()) / reach + 0.5).clamp(0.0, 1.0);
            let ay = ((half.1 - qy.abs()) / reach + 0.5).clamp(0.0, 1.0);
            out[(y * w + x) as usize] = (ax * ay * 255.0).round() as u8;
        }
    }
    out
}

/// Where the whole picture goes so the crop's rectangle fills the clip's box.
///
/// `upright` is the picture's size, `canvas` the output's, `position` (half-canvas units, +y
/// up), `scale` (signed on screen's axes, relative to the contain-fit of the *cropped*
/// picture, as the clip's transform has it) and `rotation` (clockwise degrees) the clip's.
/// Returns the position, scale (relative to the contain-fit of the whole picture) and rotation
/// for the whole picture.
pub fn place(c: &CropRect, upright: (f64, f64), canvas: (f64, f64), position: [f64; 2], scale: [f64; 2], rotation: f64) -> ([f64; 2], [f64; 2], f64) {
    let (uw, uh) = (upright.0.max(1.0), upright.1.max(1.0));
    let (cw, ch) = ((c.width * uw).max(1e-6), (c.height * uh).max(1e-6));
    let fit_crop = (canvas.0 / cw).min(canvas.1 / ch);
    let fit_full = (canvas.0 / uw).min(canvas.1 / uh);
    let k = fit_crop / fit_full;
    let whole_scale = [scale[0] * k, scale[1] * k];
    // The whole picture's size on screen, and where the rectangle's centre is in it.
    let (fw, fh) = (uw * fit_full * whole_scale[0].abs(), uh * fit_full * whole_scale[1].abs());
    let d = [(c.x + c.width / 2.0 - 0.5) * fw * whole_scale[0].signum(), (c.y + c.height / 2.0 - 0.5) * fh * whole_scale[1].signum()];
    let total = rotation + c.rotation;
    let (sin, cos) = total.to_radians().sin_cos();
    let turned = [cos * d[0] - sin * d[1], sin * d[0] + cos * d[1]];
    // Canvas pixels (y down) of the rectangle's centre, and of the picture's.
    let at = [canvas.0 / 2.0 + position[0] * canvas.0 / 2.0, canvas.1 / 2.0 - position[1] * canvas.1 / 2.0];
    let whole = [at[0] - turned[0], at[1] - turned[1]];
    ([(whole[0] - canvas.0 / 2.0) / (canvas.0 / 2.0), -(whole[1] - canvas.1 / 2.0) / (canvas.1 / 2.0)], whole_scale, total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64, rotation: f64) -> CropRect {
        CropRect { x, y, width, height, rotation }
    }

    #[test]
    fn coverage_is_the_rectangle() {
        let m = coverage(&rect(0.25, 0.0, 0.5, 1.0, 0.0), (400, 100), 400, 100);
        assert_eq!(m[50 * 400 + 50], 0);
        assert_eq!(m[50 * 400 + 150], 255);
        assert_eq!(m[50 * 400 + 250], 255);
        assert_eq!(m[50 * 400 + 350], 0);
    }

    #[test]
    fn a_turned_rectangle_covers_less_of_the_corners() {
        let m = coverage(&rect(0.0, 0.0, 1.0, 1.0, 45.0), (100, 100), 100, 100);
        assert_eq!(m[0], 0);
        assert_eq!(m[50 * 100 + 50], 255);
    }

    #[test]
    fn place_keeps_the_rectangle_where_the_box_is() {
        // The left half of a 200x100 picture on a 200x100 canvas: the box is 100x100 centred
        // on the canvas, so the whole picture's centre is 50 px to the right of it.
        let (pos, scale, rot) = place(&rect(0.0, 0.0, 0.5, 1.0, 0.0), (200.0, 100.0), (200.0, 100.0), [0.0, 0.0], [1.0, 1.0], 0.0);
        assert!((scale[0] - 1.0).abs() < 1e-9 && (scale[1] - 1.0).abs() < 1e-9 && rot == 0.0);
        assert!((pos[0] - 0.5).abs() < 1e-9, "{pos:?}");
        assert!(pos[1].abs() < 1e-9);
    }

    #[test]
    fn a_cropped_picture_fits_larger_at_scale_one() {
        // A square crop of a wide picture fits the canvas's height: the whole picture is
        // drawn wider than a contain-fit of itself would.
        let (_, scale, _) = place(&rect(0.25, 0.0, 0.5, 1.0, 0.0), (200.0, 100.0), (100.0, 100.0), [0.0, 0.0], [1.0, 1.0], 0.0);
        assert!((scale[0] - 2.0).abs() < 1e-9, "{scale:?}");
    }
}
