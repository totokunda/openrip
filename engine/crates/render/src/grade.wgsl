// CapCut's colour features around its Adjust pass, on one clip's staged (premultiplied)
// pixels; parameters from grade.rs. Docs: docs/parity/colour.md.

struct ColourParams {
    // Curves: each channel's strength (luma, red, green, blue).
    curves: vec4<f32>,
    // Enables: HSL, curves.
    on: vec4<f32>,
    // HSL: each range's hues in degrees (outer left, inner left, inner right, outer right;
    // the eight named ranges, then ten picked colours), then its hue, saturation and
    // lightness shift.
    ranges: array<vec4<f32>, 18>,
    shifts: array<vec4<f32>, 18>,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: ColourParams;
// Curve tables: 1024 entries per row; rows luma, red, green, blue.
@group(0) @binding(2) var tables: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

// A level looked up in one curve's table, nearest entry (CapCut reads it unfiltered).
fn table(row: i32, x: f32) -> f32 {
    let i = clamp(i32(floor(x * 1024.0)), 0, 1023);
    return textureLoad(tables, vec2<i32>(i, row), 0).r;
}

fn luma709(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// CapCut's curves: each channel through its own curve, then every channel moved by what the
// luma curve does to the original's luma (so the result's luma is the luma curve's).
fn curves(src: vec3<f32>) -> vec3<f32> {
    var c = src;
    c.r = src.r + (table(1, src.r) - src.r) * P.curves.y;
    c.g = src.g + (table(2, src.g) - src.g) * P.curves.z;
    c.b = src.b + (table(3, src.b) - src.b) * P.curves.w;
    let y_src = luma709(src);
    let y_new = table(0, y_src);
    c += vec3<f32>((y_new - y_src) * P.curves.x - (luma709(c) - y_src));
    return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Hue in degrees, saturation and lightness, as CapCut's HSL shader computes them.
fn rgb_to_hsl(c: vec3<f32>) -> vec3<f32> {
    let hi = max(c.r, max(c.g, c.b));
    let lo = min(c.r, min(c.g, c.b));
    let d = hi - lo;
    let l = (hi + lo) / 2.0;
    if (d == 0.0) {
        return vec3<f32>(0.0, 0.0, l);
    }
    var s = d / (2.0 - (hi + lo));
    if (l <= 0.5) {
        s = d / (hi + lo);
    }
    var h: f32;
    if (hi == c.r) {
        h = 60.0 * (c.g - c.b) / d;
        if (c.g < c.b) {
            h += 360.0;
        }
    } else if (hi == c.g) {
        h = 60.0 * (c.b - c.r) / d + 120.0;
    } else {
        h = 60.0 * (c.r - c.g) / d + 240.0;
    }
    return vec3<f32>(h, s, l);
}

fn hue_channel(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) {
        t += 1.0;
    }
    if (t > 1.0) {
        t -= 1.0;
    }
    if (t < 1.0 / 6.0) {
        return p + (q - p) * 6.0 * t;
    }
    if (t < 0.5) {
        return q;
    }
    if (t < 2.0 / 3.0) {
        return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    }
    return p;
}

fn hsl_to_rgb(hsl: vec3<f32>) -> vec3<f32> {
    if (hsl.y == 0.0) {
        return vec3<f32>(hsl.z);
    }
    let h = hsl.x / 360.0;
    var q = hsl.z + hsl.y - hsl.z * hsl.y;
    if (hsl.z < 0.5) {
        q = hsl.z * (1.0 + hsl.y);
    }
    let p = 2.0 * hsl.z - q;
    return vec3<f32>(hue_channel(p, q, h + 1.0 / 3.0), hue_channel(p, q, h), hue_channel(p, q, h - 1.0 / 3.0));
}

// How much of a range's shift a hue takes: all of it between the inner hues, fading to none
// at the outer ones. The four layouts are CapCut's: the inner hues wrapping past 360, the
// outer left one, neither, or the outer right one.
fn range_weight(h: f32, r: vec4<f32>) -> f32 {
    let ll = r.x;
    let l = r.y;
    let rr = r.w;
    let rt = r.z;
    if (ll < l && l > rt && rt < rr) {
        if (h >= l && h <= 360.0) || (h >= 0.0 && h <= rt) {
            return 1.0;
        }
        if (h >= ll && h <= l) {
            return (h - ll) / (l - ll);
        }
        if (h >= rt && h <= rr) {
            return (rr - h) / (rr - rt);
        }
    }
    if (ll > l && l < rt && rt < rr) {
        if (h >= l && h <= rt) {
            return 1.0;
        }
        if (h >= 0.0 && h <= l) {
            return (h + 360.0 - ll) / (l + 360.0 - ll);
        }
        if (h >= ll && h <= 360.0) {
            return (h - ll) / (l + 360.0 - ll);
        }
        if (h >= rt && h <= rr) {
            return (rr - h) / (rr - rt);
        }
    }
    if (ll <= l && l < rt && rt <= rr) {
        if (h >= l && h <= rt) {
            return 1.0;
        }
        if (h >= ll && h <= l) {
            return (h - ll) / (l - ll);
        }
        if (h >= rt && h <= rr) {
            return (rr - h) / (rr - rt);
        }
    }
    if (ll < l && l < rt && rt > rr) {
        if (h >= l && h <= rt) {
            return 1.0;
        }
        if (h >= ll && h <= l) {
            return (h - ll) / (l - ll);
        }
        if (h >= rt && h <= 360.0) {
            return (rr + 360.0 - h) / (rr + 360.0 - rt);
        }
        if (h >= 0.0 && h <= rr) {
            return (rr - h) / (rr + 360.0 - rt);
        }
    }
    return 0.0;
}

// CapCut's HSL: the shifts of every range the pixel's hue falls in, added up, then hue
// turned, saturation scaled, and lightness pushed by the saturation it has.
fn hsl(c: vec3<f32>) -> vec3<f32> {
    var v = rgb_to_hsl(c);
    var d = vec3<f32>(0.0);
    for (var i = 0; i < 18; i++) {
        let r = P.ranges[i];
        if (r.x < 0.00001 && r.y < 0.00001 && r.z < 0.00001 && r.w < 0.00001) {
            continue;
        }
        d += P.shifts[i].xyz * range_weight(v.x, r);
    }
    let hue = v.x + d.x;
    v.x = hue - 360.0 * floor(hue / 360.0);
    var ds = clamp(d.y / 100.0, -1.0, 1.0);
    if (ds < 0.0) {
        v.y = v.y * (1.0 + ds);
    } else {
        ds = ds / 2.0;
        v.y = v.y + ds * v.y;
    }
    var dl = clamp(d.z / 100.0, -1.0, 1.0);
    var k = v.y;
    if (v.z < 0.5) {
        k = v.y * 2.0 * v.z;
    }
    if (dl <= 0.0) {
        v.z = v.z + k * (1.0 - v.z) * dl;
    } else {
        dl = (1.0 - ds) * dl;
        v.z = v.z + k * (1.15 - v.z) * dl;
    }
    v.y = clamp(v.y, 0.0, 1.0);
    v.z = clamp(v.z, 0.0, 1.0);
    return clamp(hsl_to_rgb(v), vec3<f32>(0.0), vec3<f32>(1.0));
}

// HSL, then curves (CapCut's order).
@fragment
fn fs_colour(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = textureLoad(src, vec2<i32>(floor(pos.xy)), 0);
    if (px.a <= 0.0) {
        return px;
    }
    var c = px.rgb / px.a;
    if (P.on.x > 0.5) {
        c = hsl(c);
    }
    if (P.on.y > 0.5) {
        c = curves(c);
    }
    return vec4<f32>(c * px.a, px.a);
}
