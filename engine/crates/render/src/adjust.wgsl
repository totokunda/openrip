// CapCut's Adjust sliders on one clip's staged (premultiplied) pixels; parameters from
// adjust.rs. Each step clamps to 0..1, as CapCut's does. Docs: docs/parity/adjust.md.

struct AdjustParams {
    tt_r: vec4<f32>,
    tt_g: vec4<f32>,
    tt_b: vec4<f32>,
    a: vec4<f32>,   // saturation, brightness, contrast, contrast pivot
    b: vec4<f32>,   // contrast: steepness, left diff, right diff, left slope diff
    c: vec4<f32>,   // contrast: right slope diff, pivot slope; highlight, shadow exponents
    d: vec4<f32>,   // black/white slope, bias; exposure; sharpen amount
    on1: vec4<f32>, // temperature/tint, saturation, brightness, contrast
    on2: vec4<f32>, // highlights, shadows, black/white, exposure
    w_lift: vec4<f32>,   // primary wheels: R, G, B, luma
    w_gamma: vec4<f32>,
    w_gain: vec4<f32>,
    w_offset: vec4<f32>, // R, G, B, saturation
    w_sat: vec4<f32>,    // saturation wheel: lift, gamma, gain; luma mix
    w_on: vec4<f32>,     // intensity, enabled
    fade: vec4<f32>,     // fade: amount, enabled
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> A: AdjustParams;
// Exposure lookup table: 17 grids of 17x17 side by side (289x17), red across, green down,
// blue picks the grid. CapCut's fade table, the same way, below it when there is one.
@group(0) @binding(2) var lut: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

const LUMA = vec3<f32>(0.208540, 0.702086, 0.089374);

fn contrast_up(x: f32) -> f32 {
    let pivot = A.a.w;
    let s = 1.0 / (1.0 + exp(-A.b.x * (x - pivot)));
    let y = s + pivot - 0.5;
    let k = A.b.x * s * (1.0 - s);
    if (x <= pivot) {
        let t = (A.c.y - k) / A.b.w;
        return y + t * t * A.b.y;
    }
    let t = (A.c.y - k) / A.c.x;
    return y + t * t * A.b.z;
}

// Bilinear lookup in one 17x17 grid at texel coordinates, in the table starting at row `top`.
fn lut_grid(grid: f32, rg: vec2<f32>, top: i32) -> vec3<f32> {
    let p = vec2<f32>(grid * 17.0 + rg.x * 16.0, rg.y * 16.0);
    let b = floor(p);
    let f = p - b;
    let i = vec2<i32>(b) + vec2<i32>(0, top);
    let j = min(i + vec2<i32>(1, 1), vec2<i32>(i32(grid) * 17 + 16, top + 16));
    let upper = mix(textureLoad(lut, i, 0).rgb, textureLoad(lut, vec2<i32>(j.x, i.y), 0).rgb, f.x);
    let lower = mix(textureLoad(lut, vec2<i32>(i.x, j.y), 0).rgb, textureLoad(lut, j, 0).rgb, f.x);
    return mix(upper, lower, f.y);
}

fn lut3d(c: vec3<f32>, top: i32) -> vec3<f32> {
    let blue = c.b * 16.0;
    return mix(lut_grid(floor(blue), c.rg, top), lut_grid(ceil(blue), c.rg, top), fract(blue));
}

fn gray709(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// One channel through a lift / gamma / gain wheel around `offset`.
fn wheel(x: f32, lift_in: f32, gamma: f32, gain_in: f32, offset: f32) -> f32 {
    let lift = min(lift_in, 0.4995);
    let gain_x = 1.0 / max(gain_in, 0.001);
    let lift_x = min(lift / (lift - 0.5), gain_x - 0.0005);
    let y = (x - offset - lift_x) / (gain_x - lift_x) + offset;
    return sign(y) * pow(abs(y), gamma);
}

fn rgb_to_hsl(c: vec3<f32>) -> vec3<f32> {
    let hi = max(c.r, max(c.g, c.b));
    let lo = min(c.r, min(c.g, c.b));
    let d = hi - lo;
    let l = (hi + lo) / 2.0;
    if (d < 0.00001) {
        return vec3<f32>(0.0, 0.0, l);
    }
    var s = d / (hi + lo);
    if (l > 0.5) {
        s = d / (2.0 - hi - lo);
    }
    var h: f32;
    if (hi - c.r < 0.00001) {
        h = 60.0 * (c.g - c.b) / d;
        if (c.g < c.b) {
            h += 360.0;
        }
    } else if (hi - c.g < 0.00001) {
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

// CapCut's primary colour wheels: per-channel wheels around the offset, the luma wheel
// restored by the luma mix, then the saturation wheel in HSL.
fn primary_wheels(orig: vec3<f32>) -> vec3<f32> {
    let off = A.w_offset.xyz;
    var c = orig + off;
    let base_y = wheel(gray709(c), A.w_lift.w, A.w_gamma.w, A.w_gain.w, gray709(off));
    c = vec3<f32>(
        wheel(c.r, A.w_lift.x, A.w_gamma.x, A.w_gain.x, off.x),
        wheel(c.g, A.w_lift.y, A.w_gamma.y, A.w_gain.y, off.y),
        wheel(c.b, A.w_lift.z, A.w_gamma.z, A.w_gain.z, off.z),
    );
    c = clamp(c + (base_y - gray709(c)) * A.w_sat.w, vec3<f32>(0.0), vec3<f32>(1.0));
    let y = gray709(c);
    var ds = A.w_offset.w;
    ds += wheel(y, A.w_sat.x, 1.0, 1.0, 0.0) - y;
    ds += wheel(y, 0.0, A.w_sat.y, 1.0, 0.0) - y;
    ds += wheel(y, 0.0, 1.0, A.w_sat.z, 0.0) - y;
    ds = clamp(ds, -1.0, 2.0);
    if (abs(ds) > 0.00001) {
        var hsl = rgb_to_hsl(c);
        hsl.y = clamp(hsl.y * (1.0 + ds), 0.0, 1.0);
        c = hsl_to_rgb(hsl);
    }
    return clamp(mix(orig, c, A.w_on.x), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_adjust(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = textureLoad(src, vec2<i32>(floor(pos.xy)), 0);
    if (px.a <= 0.0) {
        return px;
    }
    var c = px.rgb / px.a;
    let zero = vec3<f32>(0.0);
    let one = vec3<f32>(1.0);
    if (A.w_on.y > 0.5) {
        c = primary_wheels(c);
    }
    if (A.on1.z > 0.5) {
        // Brightness: y = 1 - (1 - x)^p, with a small offset when darkening.
        let b = A.a.y;
        var p = 1.0 + b * 5.0;
        if (b <= 0.0) {
            p = 1.0 / (1.0 - b * 2.5);
            c = c + b * 0.01;
        }
        c = clamp(one - pow(max(one - c, zero), vec3<f32>(p)), zero, one);
    }
    if (A.on1.w > 0.5) {
        if (A.a.z <= 1.0) {
            c = A.a.z * (c - A.a.w) + A.a.w;
        } else {
            c = vec3<f32>(contrast_up(c.r), contrast_up(c.g), contrast_up(c.b));
        }
        c = clamp(c, zero, one);
    }
    if (A.on1.y > 0.5) {
        let s = A.a.x;
        let l = dot(c, LUMA) * (1.0 - s);
        c = clamp(vec3<f32>(l) + s * c, zero, one);
    }
    if (A.on2.x > 0.5) {
        let p = A.c.z;
        let t = one - c;
        c = clamp(one - pow(max(t, zero), vec3<f32>(p)) - (p - 1.0) * (t * t - t * t * t), zero, one);
    }
    if (A.on2.y > 0.5) {
        let p = A.c.w;
        c = clamp(pow(max(c, zero), vec3<f32>(p)) + (p - 1.0) * (c * c - c * c * c), zero, one);
    }
    if (A.on2.z > 0.5) {
        c = clamp(A.d.x * c + A.d.y, zero, one);
    }
    if (A.on1.x > 0.5) {
        c = clamp(vec3<f32>(dot(c, A.tt_r.xyz), dot(c, A.tt_g.xyz), dot(c, A.tt_b.xyz)), zero, one);
    }
    if (A.fade.y > 0.5) {
        c = clamp(mix(c, lut3d(c, 17), A.fade.x), zero, one);
    }
    if (A.on2.w > 0.5) {
        c = clamp(mix(c, lut3d(c, 0), abs(A.d.z)), zero, one);
    }
    return vec4<f32>(c * px.a, px.a);
}

fn straight(p: vec2<i32>) -> vec4<f32> {
    let s = vec2<i32>(textureDimensions(src)) - 1;
    let px = textureLoad(src, clamp(p, vec2<i32>(0), s), 0);
    if (px.a <= 0.0) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(px.rgb / px.a, px.a);
}

fn luma601(c: vec4<f32>) -> f32 {
    return dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
}

// CapCut's Sharpen: the strongest of four directional second differences of luma
// (horizontal, vertical, the two diagonals; the first within 0.01 of the strongest),
// scaled by the amount and added to every channel.
@fragment
fn fs_sharpen_luma(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let centre = straight(p);
    if (centre.a <= 0.0) {
        return vec4<f32>(0.0);
    }
    let y = luma601(centre);
    let f1 = 2.0 * y - luma601(straight(p + vec2<i32>(-1, 0))) - luma601(straight(p + vec2<i32>(1, 0)));
    let f2 = 2.0 * y - luma601(straight(p + vec2<i32>(0, -1))) - luma601(straight(p + vec2<i32>(0, 1)));
    let f3 = 2.0 * y - luma601(straight(p + vec2<i32>(1, -1))) - luma601(straight(p + vec2<i32>(-1, 1)));
    let f4 = 2.0 * y - luma601(straight(p + vec2<i32>(-1, -1))) - luma601(straight(p + vec2<i32>(1, 1)));
    let m = max(max(abs(f1), abs(f2)), max(abs(f3), abs(f4)));
    var f = f4;
    if (abs(abs(f1) - m) <= 0.01) {
        f = f1;
    } else if (abs(abs(f2) - m) <= 0.01) {
        f = f2;
    } else if (abs(abs(f3) - m) <= 0.01) {
        f = f3;
    }
    let c = clamp(centre.rgb + vec3<f32>(A.d.w * f), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(c * centre.a, centre.a);
}
