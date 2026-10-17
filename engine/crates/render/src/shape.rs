//! Vector graphics (the app's shapes and drawings), rasterised on the CPU the way Konva
//! draws them: each path filled, then stroked centred on its outline, then laid over the
//! paths before it.

use swash::zeno::{Cap, Command, Fill, Join, Mask, Point, Stroke};

use crate::RgbaImage;

/// One path of a shape, already in its box's units (origin at the box's top-left).
pub struct ShapePath {
    pub commands: Vec<Command>,
    /// Straight-alpha colours.
    pub fill: Option<[u8; 4]>,
    /// Colour, width in the box's units, and its caps and joins.
    pub stroke: Option<([u8; 4], f32, Ends)>,
    pub opacity: f32,
    pub blend: Blend,
}

/// A stroke's caps and joins, as Konva names them.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Ends {
    /// Butt caps, mitred joins (Konva's default).
    Butt,
    Round,
    /// Square caps, bevelled joins.
    Square,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Blend {
    Normal,
    /// Multiplies what's under it: the paths before it here, and (as its own layer) the
    /// canvas under the shape.
    Multiply,
    /// Removes what the earlier paths drew.
    Erase,
}

/// A rasterised shape: layers of the same size, bottom first, each a run of paths drawn
/// normally or multiplied.
pub struct RenderedShape {
    /// Straight-alpha pixels, and whether the layer multiplies what's under it.
    pub layers: Vec<(RgbaImage, bool)>,
    /// Where the box's centre is, in image pixels.
    pub center: [f64; 2],
}

/// Draw `paths` in a box of `size` units, `scale`d on each axis, at `px` pixels per unit.
/// `origin` is the fractional pixel position of the box's top-left, so the image lines up
/// with the canvas grid.
pub fn rasterize(size: [f32; 2], scale: [f32; 2], px: f32, paths: &[ShapePath], origin: [f32; 2]) -> RenderedShape {
    let (sx, sy) = (scale[0] * px, scale[1] * px);
    // Strokes scale with the shape; a non-uniform scale is taken as its geometric mean.
    let stroke_scale = (sx.abs() * sy.abs()).sqrt();
    let reach = paths.iter().filter_map(|p| p.stroke.map(|s| s.1 * stroke_scale / 2.0)).fold(0.0, f32::max);
    let margin = (reach + 2.0).ceil();
    let (bw, bh) = ((size[0] * sx).abs(), (size[1] * sy).abs());
    let (w, h) = ((bw + 2.0 * margin).ceil() as u32 + 1, (bh + 2.0 * margin).ceil() as u32 + 1);
    let (ox, oy) = (margin + origin[0], margin + origin[1]);
    let map = |p: Point| Point::new(ox + p.x * sx, oy + p.y * sy);
    // Premultiplied runs of paths, each flagged when it multiplies.
    let mut runs: Vec<(Vec<[f32; 4]>, bool)> = Vec::new();
    for path in paths {
        let cmds: Vec<Command> = path
            .commands
            .iter()
            .map(|c| match *c {
                Command::MoveTo(p) => Command::MoveTo(map(p)),
                Command::LineTo(p) => Command::LineTo(map(p)),
                Command::CurveTo(a, b, p) => Command::CurveTo(map(a), map(b), map(p)),
                Command::QuadTo(a, p) => Command::QuadTo(map(a), map(p)),
                Command::Close => Command::Close,
            })
            .collect();
        let coverage = |style_fill: Option<Fill>, stroke: Option<(f32, Ends)>| -> Vec<f32> {
            let mut mask = Mask::new(&cmds[..]);
            mask.size(w, h);
            match (style_fill, stroke) {
                (Some(f), _) => {
                    mask.style(f);
                }
                (None, Some((width, ends))) => {
                    let mut s = Stroke::new(width);
                    match ends {
                        Ends::Butt => s.join(Join::Miter).cap(Cap::Butt),
                        Ends::Round => s.join(Join::Round).cap(Cap::Round),
                        Ends::Square => s.join(Join::Bevel).cap(Cap::Square),
                    };
                    mask.style(s);
                }
                _ => {}
            }
            let (data, placement) = mask.render();
            let mut out = vec![0f32; (w * h) as usize];
            for row in 0..placement.height as i32 {
                for col in 0..placement.width as i32 {
                    let (x, y) = (placement.left + col, placement.top + row);
                    if x >= 0 && y >= 0 && (x as u32) < w && (y as u32) < h {
                        out[(y as u32 * w + x as u32) as usize] = data[(row * placement.width as i32 + col) as usize] as f32 / 255.0;
                    }
                }
            }
            out
        };
        // The path on its own: fill, then the stroke over it (premultiplied).
        let mut layer = vec![[0f32; 4]; (w * h) as usize];
        if let Some(c) = path.fill {
            for (l, a) in layer.iter_mut().zip(coverage(Some(Fill::NonZero), None)) {
                *l = over(premul(c, a), *l);
            }
        }
        if let Some((c, width, ends)) = path.stroke.filter(|s| s.1 > 0.0) {
            for (l, a) in layer.iter_mut().zip(coverage(None, Some((width * stroke_scale, ends)))) {
                *l = over(premul(c, a), *l);
            }
        }
        let opacity = path.opacity.clamp(0.0, 1.0);
        if path.blend == Blend::Erase {
            for (o, l) in runs.iter_mut().flat_map(|(r, _)| r.iter_mut().zip(&layer)) {
                let keep = 1.0 - l[3];
                o.iter_mut().for_each(|v| *v *= keep);
            }
            continue;
        }
        let multiply = path.blend == Blend::Multiply;
        if runs.last().is_none_or(|r| r.1 != multiply) {
            runs.push((vec![[0f32; 4]; (w * h) as usize], multiply));
        }
        let run = &mut runs.last_mut().unwrap().0;
        for (o, l) in run.iter_mut().zip(&layer) {
            let l = l.map(|v| v * opacity);
            *o = if multiply { multiply_over(l, *o) } else { over(l, *o) };
        }
    }
    let layers = runs
        .into_iter()
        .map(|(run, multiply)| {
            let data = run
                .iter()
                .flat_map(|p| {
                    let a = p[3].clamp(0.0, 1.0);
                    let un = |v: f32| if a > 0.0 { (v / a * 255.0).round().clamp(0.0, 255.0) as u8 } else { 0 };
                    [un(p[0]), un(p[1]), un(p[2]), (a * 255.0).round() as u8]
                })
                .collect();
            (RgbaImage { width: w, height: h, data }, multiply)
        })
        .collect();
    RenderedShape { layers, center: [(ox + bw / 2.0) as f64, (oy + bh / 2.0) as f64] }
}

fn premul(c: [u8; 4], cov: f32) -> [f32; 4] {
    let a = cov * c[3] as f32 / 255.0;
    [c[0] as f32 / 255.0 * a, c[1] as f32 / 255.0 * a, c[2] as f32 / 255.0 * a, a]
}

fn over(top: [f32; 4], under: [f32; 4]) -> [f32; 4] {
    std::array::from_fn(|k| top[k] + under[k] * (1.0 - top[3]))
}

/// The canvas's multiply, premultiplied: cs·(1−αb) + cb·(1−αs) + cs·cb.
fn multiply_over(top: [f32; 4], under: [f32; 4]) -> [f32; 4] {
    std::array::from_fn(|k| if k == 3 { top[3] + under[3] * (1.0 - top[3]) } else { top[k] * (1.0 - under[3]) + under[k] * (1.0 - top[3]) + top[k] * under[k] })
}

/// Cubic Bézier control-point distance for a quarter circle.
const KAPPA: f32 = 0.552_284_8;

/// Konva's rectangle: the box with its corners rounded by `r` (clamped to half the shorter
/// side), drawn clockwise from the top-left.
pub fn rectangle(w: f32, h: f32, r: f32) -> Vec<Command> {
    let r = r.clamp(0.0, w.min(h) / 2.0);
    let p = Point::new;
    if r <= 0.0 {
        return vec![Command::MoveTo(p(0.0, 0.0)), Command::LineTo(p(w, 0.0)), Command::LineTo(p(w, h)), Command::LineTo(p(0.0, h)), Command::Close];
    }
    let k = r * KAPPA;
    vec![
        Command::MoveTo(p(r, 0.0)),
        Command::LineTo(p(w - r, 0.0)),
        Command::CurveTo(p(w - r + k, 0.0), p(w, r - k), p(w, r)),
        Command::LineTo(p(w, h - r)),
        Command::CurveTo(p(w, h - r + k), p(w - r + k, h), p(w - r, h)),
        Command::LineTo(p(r, h)),
        Command::CurveTo(p(r - k, h), p(0.0, h - r + k), p(0.0, h - r)),
        Command::LineTo(p(0.0, r)),
        Command::CurveTo(p(0.0, r - k), p(r - k, 0.0), p(r, 0.0)),
        Command::Close,
    ]
}

/// The ellipse inscribed in a `w`×`h` box.
pub fn ellipse(w: f32, h: f32) -> Vec<Command> {
    let (cx, cy, rx, ry) = (w / 2.0, h / 2.0, w / 2.0, h / 2.0);
    let (kx, ky) = (rx * KAPPA, ry * KAPPA);
    let p = Point::new;
    vec![
        Command::MoveTo(p(cx + rx, cy)),
        Command::CurveTo(p(cx + rx, cy + ky), p(cx + kx, cy + ry), p(cx, cy + ry)),
        Command::CurveTo(p(cx - kx, cy + ry), p(cx - rx, cy + ky), p(cx - rx, cy)),
        Command::CurveTo(p(cx - rx, cy - ky), p(cx - kx, cy - ry), p(cx, cy - ry)),
        Command::CurveTo(p(cx + kx, cy - ry), p(cx + rx, cy - ky), p(cx + rx, cy)),
        Command::Close,
    ]
}

/// The app's rounded regular polygon (`RoundedRegularPolygon.tsx`), centred in the box:
/// vertex n at angle 2πn/sides from straight up; each corner cut back by up to half the
/// shorter adjoining edge and rounded with a quadratic through the vertex.
pub fn polygon(w: f32, h: f32, sides: u32, radius: f32, corner: f32) -> Vec<Command> {
    let sides = sides.max(3);
    let (cx, cy) = (w / 2.0, h / 2.0);
    let pts: Vec<Point> = (0..sides)
        .map(|n| {
            let a = n as f32 * 2.0 * std::f32::consts::PI / sides as f32;
            Point::new(cx + radius * a.sin(), cy - radius * a.cos())
        })
        .collect();
    let mut out = Vec::new();
    if corner <= 0.0 {
        out.push(Command::MoveTo(pts[0]));
        out.extend(pts[1..].iter().map(|&p| Command::LineTo(p)));
        out.push(Command::Close);
        return out;
    }
    let n = pts.len();
    for i in 0..n {
        let (cur, next, prev) = (pts[i], pts[(i + 1) % n], pts[(i + n - 1) % n]);
        let (v1, v2) = ((cur.x - prev.x, cur.y - prev.y), (next.x - cur.x, next.y - cur.y));
        let (l1, l2) = ((v1.0 * v1.0 + v1.1 * v1.1).sqrt(), (v2.0 * v2.0 + v2.1 * v2.1).sqrt());
        let r = corner.min(l1.min(l2) / 2.0);
        let start = Point::new(cur.x - v1.0 / l1 * r, cur.y - v1.1 / l1 * r);
        let end = Point::new(cur.x + v2.0 / l2 * r, cur.y + v2.1 / l2 * r);
        out.push(if i == 0 { Command::MoveTo(start) } else { Command::LineTo(start) });
        out.push(Command::QuadTo(cur, end));
    }
    out.push(Command::Close);
    out
}

/// Konva's star, centred in the box: 2·`points` vertices alternating `outer` and `inner`
/// radius, the first straight up.
pub fn star(w: f32, h: f32, points: u32, inner: f32, outer: f32) -> Vec<Command> {
    let n = points.max(2) * 2;
    let (cx, cy) = (w / 2.0, h / 2.0);
    let mut out: Vec<Command> = (0..n)
        .map(|i| {
            let r = if i % 2 == 0 { outer } else { inner };
            let a = i as f32 * std::f32::consts::PI / points.max(2) as f32;
            let p = Point::new(cx + r * a.sin(), cy - r * a.cos());
            if i == 0 { Command::MoveTo(p) } else { Command::LineTo(p) }
        })
        .collect();
    out.push(Command::Close);
    out
}

/// Konva's Line: through `points`, straight, or with `tension` a cardinal spline (Konva's
/// `_expandPoints`: a quadratic into and out of the ends, Béziers between).
pub fn line(points: &[[f32; 2]], tension: f32, closed: bool) -> Vec<Command> {
    let p = |q: [f32; 2]| Point::new(q[0], q[1]);
    let Some(&first) = points.first() else { return Vec::new() };
    let mut out = vec![Command::MoveTo(p(first))];
    if tension != 0.0 && points.len() > 2 && !closed {
        let mut tp: Vec<[f32; 2]> = Vec::new();
        for n in 1..points.len() - 1 {
            let (a, b, c) = (points[n - 1], points[n], points[n + 1]);
            let d01 = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
            let d12 = ((c[0] - b[0]).powi(2) + (c[1] - b[1]).powi(2)).sqrt();
            if d01 + d12 <= 0.0 {
                continue;
            }
            let (fa, fb) = (tension * d01 / (d01 + d12), tension * d12 / (d01 + d12));
            tp.push([b[0] - fa * (c[0] - a[0]), b[1] - fa * (c[1] - a[1])]);
            tp.push(b);
            tp.push([b[0] + fb * (c[0] - a[0]), b[1] + fb * (c[1] - a[1])]);
        }
        if tp.len() >= 3 {
            out.push(Command::QuadTo(p(tp[0]), p(tp[1])));
            let mut k = 2;
            while k + 3 < tp.len() {
                out.push(Command::CurveTo(p(tp[k]), p(tp[k + 1]), p(tp[k + 2])));
                k += 3;
            }
            out.push(Command::QuadTo(p(tp[tp.len() - 1]), p(*points.last().unwrap())));
            return out;
        }
    }
    out.extend(points[1..].iter().map(|&q| Command::LineTo(p(q))));
    if closed {
        out.push(Command::Close);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha_at(r: &RenderedShape, x: f64, y: f64) -> u8 {
        let (px, py) = ((r.center[0] + x) as u32, (r.center[1] + y) as u32);
        let img = &r.layers[0].0;
        img.data[((py * img.width + px) * 4 + 3) as usize]
    }

    #[test]
    fn a_filled_rectangle_covers_its_box_and_nothing_else() {
        let path = ShapePath { commands: rectangle(100.0, 50.0, 0.0), fill: Some([255, 0, 0, 255]), stroke: None, opacity: 1.0, blend: Blend::Normal };
        let r = rasterize([100.0, 50.0], [1.0, 1.0], 2.0, &[path], [0.0, 0.0]);
        assert_eq!(alpha_at(&r, 0.0, 0.0), 255);
        assert_eq!(alpha_at(&r, 95.0, 45.0), 255);
        assert_eq!(alpha_at(&r, 101.5, 0.0), 0);
    }

    #[test]
    fn an_eraser_removes_earlier_paths() {
        let fill = ShapePath { commands: rectangle(100.0, 100.0, 0.0), fill: Some([0, 0, 255, 255]), stroke: None, opacity: 1.0, blend: Blend::Normal };
        let erase = ShapePath { commands: line(&[[0.0, 50.0], [100.0, 50.0]], 0.0, false), fill: None, stroke: Some(([0, 0, 0, 255], 20.0, Ends::Round)), opacity: 1.0, blend: Blend::Erase };
        let r = rasterize([100.0, 100.0], [1.0, 1.0], 1.0, &[fill, erase], [0.0, 0.0]);
        assert_eq!(alpha_at(&r, 0.0, 0.0), 0);
        assert_eq!(alpha_at(&r, 0.0, -30.0), 255);
    }

    #[test]
    fn multiplied_paths_are_their_own_layer_and_darken_each_other() {
        let base = ShapePath { commands: rectangle(10.0, 10.0, 0.0), fill: Some([0, 0, 255, 255]), stroke: None, opacity: 1.0, blend: Blend::Normal };
        let half = |x: f32| ShapePath { commands: line(&[[x, 5.0], [x + 6.0, 5.0]], 0.0, false), fill: None, stroke: Some(([255, 255, 0, 255], 4.0, Ends::Butt)), opacity: 0.5, blend: Blend::Multiply };
        let r = rasterize([10.0, 10.0], [1.0, 1.0], 1.0, &[base, half(0.0), half(4.0)], [0.0, 0.0]);
        assert_eq!(r.layers.iter().map(|l| l.1).collect::<Vec<_>>(), [false, true]);
        let px = |x: u32| {
            let img = &r.layers[1].0;
            let i = ((((r.center[1] - 5.0) as u32 + 5) * img.width + (r.center[0] - 5.0) as u32 + x) * 4) as usize;
            img.data[i + 3]
        };
        // Alone each stroke is half opaque; where they cross, 1 − ½·½.
        assert_eq!((px(1), px(5)), (128, 191));
    }

    #[test]
    fn a_tensioned_line_passes_through_its_points() {
        let cmds = line(&[[0.0, 0.0], [10.0, 10.0], [20.0, 0.0], [30.0, 10.0]], 0.5, false);
        assert!(matches!(cmds.last(), Some(Command::QuadTo(_, p)) if (p.x - 30.0).abs() < 1e-4 && (p.y - 10.0).abs() < 1e-4));
        assert!(cmds.iter().any(|c| matches!(c, Command::CurveTo(..))));
    }
}
