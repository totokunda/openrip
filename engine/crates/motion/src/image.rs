//! Grey images, their gradients and Gaussian pyramids: what the trackers and the dense flow
//! work on. Intensities are 0–1; coordinates are pixel centres (pixel (x, y) covers
//! x − 0.5…x + 0.5), and reads outside an image clamp to its edge.

/// A single-channel image of `f32` intensities, row-major.
#[derive(Clone, Debug, PartialEq)]
pub struct Gray {
    pub width: usize,
    pub height: usize,
    pub data: Vec<f32>,
}

impl Gray {
    pub fn new(width: usize, height: usize) -> Gray {
        Gray { width, height, data: vec![0.0; width * height] }
    }

    /// Luma (Rec. 709 weights) of straight 8-bit RGBA pixels.
    pub fn from_rgba(width: usize, height: usize, rgba: &[u8]) -> Gray {
        let data = rgba.chunks_exact(4).take(width * height).map(|p| (0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) / 255.0).collect();
        Gray { width, height, data }
    }

    /// 8-bit luma as it is.
    pub fn from_luma8(width: usize, height: usize, luma: &[u8]) -> Gray {
        Gray { width, height, data: luma.iter().take(width * height).map(|&v| v as f32 / 255.0).collect() }
    }

    /// The pixel at (x, y), clamped to the image.
    #[inline]
    pub fn at(&self, x: isize, y: isize) -> f32 {
        let x = x.clamp(0, self.width as isize - 1) as usize;
        let y = y.clamp(0, self.height as isize - 1) as usize;
        self.data[y * self.width + x]
    }

    /// Bilinear read at (x, y), clamped to the image.
    #[inline]
    pub fn sample(&self, x: f32, y: f32) -> f32 {
        let x = x.clamp(0.0, (self.width - 1) as f32);
        let y = y.clamp(0.0, (self.height - 1) as f32);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(self.width - 1), (y0 + 1).min(self.height - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let row0 = y0 * self.width;
        let row1 = y1 * self.width;
        let top = self.data[row0 + x0] + (self.data[row0 + x1] - self.data[row0 + x0]) * fx;
        let bottom = self.data[row1 + x0] + (self.data[row1 + x1] - self.data[row1 + x0]) * fx;
        top + (bottom - top) * fy
    }

    /// Whether (x, y) lies inside the image, `margin` pixels in from its edges.
    #[inline]
    pub fn inside(&self, x: f32, y: f32, margin: f32) -> bool {
        x >= margin && y >= margin && x <= self.width as f32 - 1.0 - margin && y <= self.height as f32 - 1.0 - margin
    }

    /// Half the size: smoothed by the 5-tap binomial kernel, then every other pixel (the
    /// usual Gaussian pyramid step). Pixel (x, y) of the result sits at (2x, 2y) of this one.
    pub fn half(&self) -> Gray {
        let (w, h) = (self.width.div_ceil(2).max(1), self.height.div_ceil(2).max(1));
        const K: [f32; 5] = [1.0 / 16.0, 4.0 / 16.0, 6.0 / 16.0, 4.0 / 16.0, 1.0 / 16.0];
        // Horizontal pass at the kept columns, then vertical at the kept rows.
        let mut rows = vec![0.0f32; w * self.height];
        for y in 0..self.height {
            for x in 0..w {
                let cx = 2 * x as isize;
                let mut s = 0.0;
                for (k, wk) in K.iter().enumerate() {
                    s += wk * self.at(cx + k as isize - 2, y as isize);
                }
                rows[y * w + x] = s;
            }
        }
        let mut out = Gray::new(w, h);
        for y in 0..h {
            let cy = 2 * y as isize;
            for x in 0..w {
                let mut s = 0.0;
                for (k, wk) in K.iter().enumerate() {
                    let yy = (cy + k as isize - 2).clamp(0, self.height as isize - 1) as usize;
                    s += wk * rows[yy * w + x];
                }
                out.data[y * w + x] = s;
            }
        }
        out
    }

    /// Separable Gaussian blur of standard deviation `sigma` pixels.
    pub fn blur(&self, sigma: f32) -> Gray {
        if sigma <= 0.0 {
            return self.clone();
        }
        let kernel = gaussian_kernel(sigma);
        let r = (kernel.len() / 2) as isize;
        let mut tmp = Gray::new(self.width, self.height);
        for y in 0..self.height {
            for x in 0..self.width {
                let mut s = 0.0;
                for (k, wk) in kernel.iter().enumerate() {
                    s += wk * self.at(x as isize + k as isize - r, y as isize);
                }
                tmp.data[y * self.width + x] = s;
            }
        }
        let mut out = Gray::new(self.width, self.height);
        for y in 0..self.height {
            for x in 0..self.width {
                let mut s = 0.0;
                for (k, wk) in kernel.iter().enumerate() {
                    s += wk * tmp.at(x as isize, y as isize + k as isize - r);
                }
                out.data[y * self.width + x] = s;
            }
        }
        out
    }

    /// Area-averaged copy at `width`×`height` (each output pixel the mean of the input pixels
    /// it covers, partly covered ones weighted): for working at a lower resolution.
    pub fn resized(&self, width: usize, height: usize) -> Gray {
        let (sx, sy) = (self.width as f64 / width as f64, self.height as f64 / height as f64);
        let mut out = Gray::new(width, height);
        for y in 0..height {
            let (y0, y1) = (y as f64 * sy, (y + 1) as f64 * sy);
            for x in 0..width {
                let (x0, x1) = (x as f64 * sx, (x + 1) as f64 * sx);
                let (mut sum, mut area) = (0.0f64, 0.0f64);
                let mut yy = y0.floor() as usize;
                while (yy as f64) < y1 && yy < self.height {
                    let wy = (y1.min(yy as f64 + 1.0) - y0.max(yy as f64)).max(0.0);
                    let mut xx = x0.floor() as usize;
                    while (xx as f64) < x1 && xx < self.width {
                        let wx = (x1.min(xx as f64 + 1.0) - x0.max(xx as f64)).max(0.0);
                        sum += self.data[yy * self.width + xx] as f64 * wx * wy;
                        area += wx * wy;
                        xx += 1;
                    }
                    yy += 1;
                }
                out.data[y * width + x] = if area > 0.0 { (sum / area) as f32 } else { 0.0 };
            }
        }
        out
    }

    /// Horizontal and vertical derivatives (Scharr's 3×3 kernels, normalised so a ramp of
    /// slope 1 per pixel reads 1).
    pub fn gradients(&self) -> (Gray, Gray) {
        let (w, h) = (self.width, self.height);
        let mut gx = Gray::new(w, h);
        let mut gy = Gray::new(w, h);
        for y in 0..h as isize {
            for x in 0..w as isize {
                let p = |dx: isize, dy: isize| self.at(x + dx, y + dy);
                let dx = 3.0 * (p(1, -1) - p(-1, -1)) + 10.0 * (p(1, 0) - p(-1, 0)) + 3.0 * (p(1, 1) - p(-1, 1));
                let dy = 3.0 * (p(-1, 1) - p(-1, -1)) + 10.0 * (p(0, 1) - p(0, -1)) + 3.0 * (p(1, 1) - p(1, -1));
                let i = y as usize * w + x as usize;
                gx.data[i] = dx / 32.0;
                gy.data[i] = dy / 32.0;
            }
        }
        (gx, gy)
    }
}

/// A normalised Gaussian kernel reaching three standard deviations each side.
pub fn gaussian_kernel(sigma: f32) -> Vec<f32> {
    let r = (3.0 * sigma).ceil().max(1.0) as isize;
    let mut k: Vec<f32> = (-r..=r).map(|i| (-(i * i) as f32 / (2.0 * sigma * sigma)).exp()).collect();
    let sum: f32 = k.iter().sum();
    k.iter_mut().for_each(|v| *v /= sum);
    k
}

/// One level of a pyramid: the image and its derivatives.
#[derive(Clone, Debug)]
pub struct Level {
    pub image: Gray,
    pub gx: Gray,
    pub gy: Gray,
}

impl Level {
    pub fn new(image: Gray) -> Level {
        let (gx, gy) = image.gradients();
        Level { image, gx, gy }
    }
}

/// A Gaussian pyramid, full resolution first; each level is half the one before.
#[derive(Clone, Debug)]
pub struct Pyramid {
    pub levels: Vec<Level>,
}

impl Pyramid {
    /// Up to `levels` levels, stopping before one would be smaller than 16 pixels a side.
    pub fn new(image: Gray, levels: usize) -> Pyramid {
        let mut out = Vec::with_capacity(levels.max(1));
        let mut img = image;
        for i in 0..levels.max(1) {
            let next = (i + 1 < levels && img.width >= 32 && img.height >= 32).then(|| img.half());
            out.push(Level::new(img));
            match next {
                Some(n) => img = n,
                None => break,
            }
        }
        Pyramid { levels: out }
    }

    pub fn base(&self) -> &Gray {
        &self.levels[0].image
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ramp_has_unit_gradient_and_samples_between_pixels() {
        let mut g = Gray::new(8, 8);
        for y in 0..8 {
            for x in 0..8 {
                g.data[y * 8 + x] = x as f32 * 0.1;
            }
        }
        let (gx, gy) = g.gradients();
        assert!((gx.at(4, 4) - 0.1).abs() < 1e-6 && gy.at(4, 4).abs() < 1e-6);
        assert!((g.sample(2.5, 3.0) - 0.25).abs() < 1e-6);
        let p = Pyramid::new(Gray::new(100, 60), 5);
        assert_eq!(p.levels.iter().map(|l| (l.image.width, l.image.height)).collect::<Vec<_>>(), vec![(100, 60), (50, 30)]);
        assert!((g.resized(4, 4).data[0] - 0.05).abs() < 1e-6);
    }
}
