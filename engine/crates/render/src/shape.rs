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
    /// The stroke's dashes, on and off lengths in the box's units (empty: solid).
    pub dash: Vec<f32>,
    pub opacity: f32,
    pub blend: Blend,
}

/// The longest a mitred corner reaches past the outline, in half stroke widths (zeno's and
/// the app's preview's miter limit).
const MITER_LIMIT: f32 = 4.0;

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
/// with the canvas grid. `shadow` is a colour and an offset in the box's units: everything
/// the paths cover, in that colour, under them.
pub fn rasterize(size: [f32; 2], scale: [f32; 2], px: f32, paths: &[ShapePath], origin: [f32; 2], shadow: Option<([u8; 4], [f32; 2])>) -> RenderedShape {
    let (sx, sy) = (scale[0] * px, scale[1] * px);
    // Strokes scale with the shape; a non-uniform scale is taken as its geometric mean.
    let stroke_scale = (sx.abs() * sy.abs()).sqrt();
    let reach = paths
        .iter()
        .filter_map(|p| p.stroke.map(|s| s.1 * stroke_scale / 2.0 * if s.2 == Ends::Butt { MITER_LIMIT } else { 1.0 }))
        .fold(0.0, f32::max);
    let margin = (reach + 2.0).ceil();
    // What the paths reach in the box's units (curves stay inside their control points),
    // with the shadow's copy.
    let (mut lo, mut hi) = ([0f32, 0.0], size);
    for c in paths.iter().flat_map(|p| p.commands.iter()) {
        let (pts, n) = match *c {
            Command::MoveTo(p) | Command::LineTo(p) => ([p, p, p], 1),
            Command::QuadTo(a, p) => ([a, p, p], 2),
            Command::CurveTo(a, b, p) => ([a, b, p], 3),
            Command::Close => continue,
        };
        for p in &pts[..n] {
            lo = [lo[0].min(p.x), lo[1].min(p.y)];
            hi = [hi[0].max(p.x), hi[1].max(p.y)];
        }
    }
    if let Some((_, off)) = shadow {
        (lo, hi) = ([lo[0].min(lo[0] + off[0]), lo[1].min(lo[1] + off[1])], [hi[0].max(hi[0] + off[0]), hi[1].max(hi[1] + off[1])]);
    }
    // In pixels from the box's top-left; whole pixels before it keep the canvas's grid.
    let px_x = [lo[0] * sx, hi[0] * sx];
    let px_y = [lo[1] * sy, hi[1] * sy];
    let (before_x, before_y) = ((-px_x[0].min(px_x[1])).max(0.0).ceil(), (-px_y[0].min(px_y[1])).max(0.0).ceil());
    let (after_x, after_y) = (px_x[0].max(px_x[1]).max(0.0), px_y[0].max(px_y[1]).max(0.0));
    let (bw, bh) = ((size[0] * sx).abs(), (size[1] * sy).abs());
    let (ox, oy) = (margin + origin[0] + before_x, margin + origin[1] + before_y);
    let (w, h) = ((ox + after_x + margin).ceil() as u32 + 1, (oy + after_y + margin).ceil() as u32 + 1);
    let map = |p: Point| Point::new(ox + p.x * sx, oy + p.y * sy);
    let mapped = |commands: &[Command], d: [f32; 2]| -> Vec<Command> {
        let m = |p: Point| map(Point::new(p.x + d[0], p.y + d[1]));
        commands
            .iter()
            .map(|c| match *c {
                Command::MoveTo(p) => Command::MoveTo(m(p)),
                Command::LineTo(p) => Command::LineTo(m(p)),
                Command::CurveTo(a, b, p) => Command::CurveTo(m(a), m(b), m(p)),
                Command::QuadTo(a, p) => Command::QuadTo(m(a), m(p)),
                Command::Close => Command::Close,
            })
            .collect()
    };
    let coverage = |cmds: &[Command], style_fill: Option<Fill>, stroke: Option<(f32, Ends, &[f32])>| -> Vec<f32> {
        let mut mask = Mask::new(cmds);
        mask.size(w, h);
        match (style_fill, stroke) {
            (Some(f), _) => {
                mask.style(f);
            }
            (None, Some((width, ends, dash))) => {
                let mut s = Stroke::new(width);
                match ends {
                    Ends::Butt => s.join(Join::Miter).cap(Cap::Butt),
                    Ends::Round => s.join(Join::Round).cap(Cap::Round),
                    Ends::Square => s.join(Join::Bevel).cap(Cap::Square),
                };
                s.miter_limit(MITER_LIMIT);
                if !dash.is_empty() {
                    s.dash(dash, 0.0);
                }
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
    // A path on its own: its fill, then its stroke over it (premultiplied), moved by `d`.
    let draw = |path: &ShapePath, d: [f32; 2]| -> Vec<[f32; 4]> {
        let cmds = mapped(&path.commands, d);
        let dash: Vec<f32> = path.dash.iter().map(|v| v * stroke_scale).collect();
        let mut layer = vec![[0f32; 4]; (w * h) as usize];
        if let Some(c) = path.fill {
            for (l, a) in layer.iter_mut().zip(coverage(&cmds, Some(Fill::NonZero), None)) {
                *l = over(premul(c, a), *l);
            }
        }
        if let Some((c, width, ends)) = path.stroke.filter(|s| s.1 > 0.0) {
            for (l, a) in layer.iter_mut().zip(coverage(&cmds, None, Some((width * stroke_scale, ends, &dash)))) {
                *l = over(premul(c, a), *l);
            }
        }
        layer
    };
    // Premultiplied runs of paths, each flagged when it multiplies.
    let mut runs: Vec<(Vec<[f32; 4]>, bool)> = Vec::new();
    if let Some((color, off)) = shadow {
        // Everything the paths cover (each at its opacity), in the shadow's colour.
        let mut cover = vec![0f32; (w * h) as usize];
        for path in paths.iter().filter(|p| p.blend != Blend::Erase) {
            let opacity = path.opacity.clamp(0.0, 1.0);
            for (c, l) in cover.iter_mut().zip(draw(path, off)) {
                let a = l[3] * opacity;
                *c = a + *c * (1.0 - a);
            }
        }
        runs.push((cover.into_iter().map(|a| premul(color, a)).collect(), false));
    }
    for path in paths {
        let layer = draw(path, [0.0, 0.0]);
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
    rounded_polygon(&pts, corner)
}

/// A polygon through `points` (the app's parallelogram, trapezoid and triangle), each
/// corner rounded as `polygon` rounds them.
pub fn vertices(points: &[[f32; 2]], corner: f32) -> Vec<Command> {
    let pts: Vec<Point> = points.iter().map(|p| Point::new(p[0], p[1])).collect();
    if pts.len() < 2 {
        return Vec::new();
    }
    rounded_polygon(&pts, corner)
}

/// A closed polygon whose corners are cut back by up to `corner` (at most half the shorter
/// edge beside each) and rounded with a quadratic through the corner.
fn rounded_polygon(pts: &[Point], corner: f32) -> Vec<Command> {
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
        if l1 < 1e-6 || l2 < 1e-6 {
            out.push(if i == 0 { Command::MoveTo(cur) } else { Command::LineTo(cur) });
            continue;
        }
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

/// A pen path through `nodes`, each `[x, y, in_dx, in_dy, out_dx, out_dy]`: a cubic Bézier
/// from one point's out handle to the next's in handle (a straight line when both are
/// zero), and back to the first when `closed`.
pub fn path(nodes: &[[f32; 6]], closed: bool) -> Vec<Command> {
    let Some(first) = nodes.first() else { return Vec::new() };
    let seg = |a: &[f32; 6], b: &[f32; 6]| {
        let to = Point::new(b[0], b[1]);
        if a[4] == 0.0 && a[5] == 0.0 && b[2] == 0.0 && b[3] == 0.0 {
            Command::LineTo(to)
        } else {
            Command::CurveTo(Point::new(a[0] + a[4], a[1] + a[5]), Point::new(b[0] + b[2], b[1] + b[3]), to)
        }
    };
    let mut out = vec![Command::MoveTo(Point::new(first[0], first[1]))];
    out.extend(nodes.windows(2).map(|w| seg(&w[0], &w[1])));
    if closed && nodes.len() > 1 {
        out.push(seg(&nodes[nodes.len() - 1], first));
        out.push(Command::Close);
    }
    out
}

/// What an open outline carries at an end (the model's `StrokeMarker`).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Marker {
    None,
    /// A filled triangle `ARROW_LENGTH` widths long and as many across, its tip on the end;
    /// the outline stops inside its base.
    Arrow,
    /// A filled circle `DOT_DIAMETER` widths across, centred on the end.
    Dot,
}

/// An arrow's length and its base's width, in stroke widths.
pub const ARROW_LENGTH: f32 = 3.0;
/// A dot's diameter, in stroke widths.
pub const DOT_DIAMETER: f32 = 2.5;

/// An open outline of stroke `width` with its end marks: the outline (stopped short under an
/// arrow) and each mark as a filled outline. A closed outline has no ends and comes back
/// as it is.
pub fn with_markers(mut commands: Vec<Command>, width: f32, start: Marker, end: Marker) -> (Vec<Command>, Vec<Vec<Command>>) {
    let mut marks = Vec::new();
    if commands.len() < 2 || commands.iter().any(|c| matches!(c, Command::Close)) || width <= 0.0 {
        return (commands, marks);
    }
    let unit = |v: (f32, f32)| {
        let l = (v.0 * v.0 + v.1 * v.1).sqrt();
        (l > 1e-6).then(|| (v.0 / l, v.1 / l))
    };
    let sub = |a: Point, b: Point| (a.x - b.x, a.y - b.y);
    let back = |p: Point, d: (f32, f32), t: f32| Point::new(p.x - d.0 * t, p.y - d.1 * t);
    // The last segment's end, the point before it, and its last control point.
    let last = commands.len() - 1;
    let before_last = commands[..last].iter().rev().find_map(|c| match *c {
        Command::MoveTo(p) | Command::LineTo(p) | Command::QuadTo(_, p) | Command::CurveTo(_, _, p) => Some(p),
        Command::Close => None,
    });
    let first = match commands[0] {
        Command::MoveTo(p) => p,
        _ => return (commands, marks),
    };
    // Each end's point and the direction leaving the outline there.
    let end_at = match commands[last] {
        Command::LineTo(p) => before_last.and_then(|q| unit(sub(p, q))).map(|d| (p, d)),
        Command::QuadTo(a, p) => unit(sub(p, a)).or_else(|| before_last.and_then(|q| unit(sub(p, q)))).map(|d| (p, d)),
        Command::CurveTo(a, b, p) => unit(sub(p, b)).or_else(|| unit(sub(p, a))).or_else(|| before_last.and_then(|q| unit(sub(p, q)))).map(|d| (p, d)),
        _ => None,
    };
    let start_at = match commands[1] {
        Command::LineTo(p) => unit(sub(first, p)),
        Command::QuadTo(a, p) => unit(sub(first, a)).or_else(|| unit(sub(first, p))),
        Command::CurveTo(a, b, p) => unit(sub(first, a)).or_else(|| unit(sub(first, b))).or_else(|| unit(sub(first, p))),
        _ => None,
    }
    .map(|d| (first, d));
    let mark = |kind: Marker, at: Point, d: (f32, f32)| -> Option<Vec<Command>> {
        match kind {
            Marker::None => None,
            Marker::Arrow => {
                let (len, half) = (ARROW_LENGTH * width, ARROW_LENGTH * width / 2.0);
                let base = back(at, d, len);
                let n = (-d.1, d.0);
                Some(vec![
                    Command::MoveTo(at),
                    Command::LineTo(Point::new(base.x + n.0 * half, base.y + n.1 * half)),
                    Command::LineTo(Point::new(base.x - n.0 * half, base.y - n.1 * half)),
                    Command::Close,
                ])
            }
            Marker::Dot => {
                let r = DOT_DIAMETER * width / 2.0;
                Some(ellipse(2.0 * r, 2.0 * r).into_iter().map(|c| shift(c, at.x - r, at.y - r)).collect())
            }
        }
    };
    // Under an arrow the outline stops a little inside its base, so its butt end is hidden.
    let trim = ARROW_LENGTH * width * 0.9;
    if let Some((at, d)) = end_at {
        marks.extend(mark(end, at, d));
        if end == Marker::Arrow {
            commands[last] = match commands[last] {
                Command::LineTo(p) => Command::LineTo(back(p, d, trim)),
                Command::QuadTo(a, p) => Command::QuadTo(back(a, d, trim), back(p, d, trim)),
                Command::CurveTo(a, b, p) => Command::CurveTo(a, back(b, d, trim), back(p, d, trim)),
                c => c,
            };
        }
    }
    if let Some((at, d)) = start_at {
        marks.extend(mark(start, at, d));
        if start == Marker::Arrow {
            commands[0] = Command::MoveTo(back(at, d, trim));
            commands[1] = match commands[1] {
                Command::QuadTo(a, p) => Command::QuadTo(back(a, d, trim), p),
                Command::CurveTo(a, b, p) => Command::CurveTo(back(a, d, trim), b, p),
                c => c,
            };
        }
    }
    (commands, marks)
}

fn shift(c: Command, dx: f32, dy: f32) -> Command {
    let m = |p: Point| Point::new(p.x + dx, p.y + dy);
    match c {
        Command::MoveTo(p) => Command::MoveTo(m(p)),
        Command::LineTo(p) => Command::LineTo(m(p)),
        Command::CurveTo(a, b, p) => Command::CurveTo(m(a), m(b), m(p)),
        Command::QuadTo(a, p) => Command::QuadTo(m(a), m(p)),
        Command::Close => Command::Close,
    }
}

/// A stroke's dashes for its style, in the stroke's units: 4-width dashes with 2-width gaps,
/// or round dots every 2 widths (drawn with round caps); empty when solid.
pub fn dashes(style: Dash, width: f32) -> Vec<f32> {
    match style {
        Dash::Solid => Vec::new(),
        Dash::Dashed => vec![4.0 * width, 2.0 * width],
        // A dot is a dash of (almost) no length with round caps.
        Dash::Dotted => vec![0.001, 2.0 * width],
    }
}

/// A stroke's pattern (the model's `StrokeDash`).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Dash {
    Solid,
    Dashed,
    Dotted,
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
        let path = ShapePath { commands: rectangle(100.0, 50.0, 0.0), fill: Some([255, 0, 0, 255]), stroke: None, dash: vec![], opacity: 1.0, blend: Blend::Normal };
        let r = rasterize([100.0, 50.0], [1.0, 1.0], 2.0, &[path], [0.0, 0.0], None);
        assert_eq!(alpha_at(&r, 0.0, 0.0), 255);
        assert_eq!(alpha_at(&r, 95.0, 45.0), 255);
        assert_eq!(alpha_at(&r, 101.5, 0.0), 0);
    }

    #[test]
    fn an_eraser_removes_earlier_paths() {
        let fill = ShapePath { commands: rectangle(100.0, 100.0, 0.0), fill: Some([0, 0, 255, 255]), stroke: None, dash: vec![], opacity: 1.0, blend: Blend::Normal };
        let erase = ShapePath { commands: line(&[[0.0, 50.0], [100.0, 50.0]], 0.0, false), fill: None, stroke: Some(([0, 0, 0, 255], 20.0, Ends::Round)), dash: vec![], opacity: 1.0, blend: Blend::Erase };
        let r = rasterize([100.0, 100.0], [1.0, 1.0], 1.0, &[fill, erase], [0.0, 0.0], None);
        assert_eq!(alpha_at(&r, 0.0, 0.0), 0);
        assert_eq!(alpha_at(&r, 0.0, -30.0), 255);
    }

    #[test]
    fn multiplied_paths_are_their_own_layer_and_darken_each_other() {
        let base = ShapePath { commands: rectangle(10.0, 10.0, 0.0), fill: Some([0, 0, 255, 255]), stroke: None, dash: vec![], opacity: 1.0, blend: Blend::Normal };
        let half = |x: f32| ShapePath { commands: line(&[[x, 5.0], [x + 6.0, 5.0]], 0.0, false), fill: None, stroke: Some(([255, 255, 0, 255], 4.0, Ends::Butt)), dash: vec![], opacity: 0.5, blend: Blend::Multiply };
        let r = rasterize([10.0, 10.0], [1.0, 1.0], 1.0, &[base, half(0.0), half(4.0)], [0.0, 0.0], None);
        assert_eq!(r.layers.iter().map(|l| l.1).collect::<Vec<_>>(), [false, true]);
        let px = |x: u32| {
            let img = &r.layers[1].0;
            let i = ((((r.center[1] - 5.0) as u32 + 5) * img.width + (r.center[0] - 5.0) as u32 + x) * 4) as usize;
            img.data[i + 3]
        };
        // Alone each stroke is half opaque; where they cross, 1 − ½·½.
        assert_eq!((px(1), px(5)), (128, 191));
    }

    fn filled(commands: Vec<Command>) -> ShapePath {
        ShapePath { commands, fill: Some([255, 255, 255, 255]), stroke: None, dash: vec![], opacity: 1.0, blend: Blend::Normal }
    }

    #[test]
    fn a_parallelogram_leans_right_and_its_corners_round() {
        // CapCut's parallelogram proportions: the top edge a third of the box to the right.
        let pts = [[100.0 / 3.0, 0.0], [100.0, 0.0], [200.0 / 3.0, 100.0], [0.0, 100.0]];
        let r = rasterize([100.0, 100.0], [1.0, 1.0], 1.0, &[filled(vertices(&pts, 0.0))], [0.0, 0.0], None);
        // Near the top the left side is empty and the right full; near the bottom, the reverse.
        assert_eq!((alpha_at(&r, -45.0, -45.0), alpha_at(&r, 45.0, -45.0)), (0, 255));
        assert_eq!((alpha_at(&r, -45.0, 45.0), alpha_at(&r, 45.0, 45.0)), (255, 0));
        // Rounding cuts the sharp top-right corner off.
        let round = rasterize([100.0, 100.0], [1.0, 1.0], 1.0, &[filled(vertices(&pts, 20.0))], [0.0, 0.0], None);
        assert_eq!((alpha_at(&r, 48.0, -49.0), alpha_at(&round, 48.0, -49.0)), (255, 0));
    }

    #[test]
    fn a_pen_path_curves_through_its_handles_and_closes() {
        // Two points with handles bulging the segment between them downward, closed.
        let nodes = [[0.0, 0.0, 0.0, 0.0, 0.0, 60.0], [100.0, 0.0, 0.0, 60.0, 0.0, 0.0]];
        let cmds = path(&nodes, true);
        assert!(matches!(cmds[1], Command::CurveTo(a, b, p) if a == Point::new(0.0, 60.0) && b == Point::new(100.0, 60.0) && p == Point::new(100.0, 0.0)));
        assert!(matches!(cmds[2], Command::LineTo(p) if p == Point::new(0.0, 0.0)));
        assert!(matches!(cmds.last(), Some(Command::Close)));
        // Filled, it covers the bulge below the chord (the curve reaches 3/4 of 60 at its middle).
        let r = rasterize([100.0, 45.0], [1.0, 1.0], 1.0, &[filled(cmds)], [0.0, 0.0], None);
        assert_eq!((alpha_at(&r, 0.0, 15.0), alpha_at(&r, 0.0, 30.0)), (255, 0));
        // Open, it's a line through its points.
        assert!(!path(&nodes, false).iter().any(|c| matches!(c, Command::Close)));
        assert!(path(&[], true).is_empty());
    }

    #[test]
    fn an_arrow_marks_the_end_and_the_line_stops_under_it() {
        let (line_cmds, marks) = with_markers(line(&[[0.0, 5.0], [100.0, 5.0]], 0.0, false), 4.0, Marker::None, Marker::Arrow);
        assert_eq!(marks.len(), 1);
        // The tip on the end, the base 3 widths back and 3 widths across.
        assert!(matches!(marks[0][0], Command::MoveTo(p) if p == Point::new(100.0, 5.0)));
        assert!(matches!(marks[0][1], Command::LineTo(p) if (p.x - 88.0).abs() < 1e-4 && (p.y - 11.0).abs() < 1e-4));
        // The line stops inside the arrow's base.
        assert!(matches!(line_cmds[1], Command::LineTo(p) if (p.x - (100.0 - 12.0 * 0.9)).abs() < 1e-4));
        // A dot goes at the start without trimming; a closed outline gets no marks.
        let (cmds, marks) = with_markers(line(&[[0.0, 5.0], [100.0, 5.0]], 0.0, false), 4.0, Marker::Dot, Marker::None);
        assert!(matches!(cmds[0], Command::MoveTo(p) if p == Point::new(0.0, 5.0)));
        assert_eq!(marks.len(), 1);
        let (_, marks) = with_markers(rectangle(10.0, 10.0, 0.0), 4.0, Marker::Arrow, Marker::Arrow);
        assert!(marks.is_empty());
    }

    #[test]
    fn dashes_leave_gaps_and_a_shadow_sits_under_the_shape() {
        let stroke = |dash: Vec<f32>| ShapePath { commands: line(&[[0.0, 5.0], [120.0, 5.0]], 0.0, false), fill: None, stroke: Some(([255, 255, 255, 255], 4.0, Ends::Butt)), dash, opacity: 1.0, blend: Blend::Normal };
        let solid = rasterize([120.0, 10.0], [1.0, 1.0], 1.0, &[stroke(vec![])], [0.0, 0.0], None);
        let dashed = rasterize([120.0, 10.0], [1.0, 1.0], 1.0, &[stroke(dashes(Dash::Dashed, 4.0))], [0.0, 0.0], None);
        // Dashes 16 on, 8 off from the start: 20 in is a gap, 10 in a dash.
        assert_eq!((alpha_at(&solid, -40.0, 0.0), alpha_at(&dashed, -50.0, 0.0), alpha_at(&dashed, -40.0, 0.0)), (255, 255, 0));
        // A black shadow 10 right and 10 down of a white square shows past its corner.
        let r = rasterize([40.0, 40.0], [1.0, 1.0], 1.0, &[filled(rectangle(40.0, 40.0, 0.0))], [0.0, 0.0], Some(([0, 0, 0, 128], [10.0, 10.0])));
        assert_eq!(r.layers.len(), 1);
        let px = |x: f64, y: f64| {
            let img = &r.layers[0].0;
            let (px, py) = ((r.center[0] + x) as u32, (r.center[1] + y) as u32);
            img.data[((py * img.width + px) * 4) as usize..][..4].to_vec()
        };
        assert_eq!(px(0.0, 0.0), vec![255, 255, 255, 255]);
        assert_eq!(px(25.0, 25.0), vec![0, 0, 0, 128]);
        assert_eq!(px(-25.0, -15.0)[3], 0);
    }

    #[test]
    fn a_tensioned_line_passes_through_its_points() {
        let cmds = line(&[[0.0, 0.0], [10.0, 10.0], [20.0, 0.0], [30.0, 10.0]], 0.5, false);
        assert!(matches!(cmds.last(), Some(Command::QuadTo(_, p)) if (p.x - 30.0).abs() < 1e-4 && (p.y - 10.0).abs() < 1e-4));
        assert!(cmds.iter().any(|c| matches!(c, Command::CurveTo(..))));
    }
}
