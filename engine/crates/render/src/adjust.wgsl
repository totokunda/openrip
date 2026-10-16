// CapCut's Adjust sliders on one clip's staged (premultiplied) pixels; parameters from
// adjust.rs. Each step clamps to 0..1, as CapCut's does. Docs: docs/parity/adjust.md.

struct AdjustParams {
    tt_r: vec4<f32>,
    tt_g: vec4<f32>,
    tt_b: vec4<f32>,
    a: vec4<f32>,   // saturation, brightness, contrast, contrast pivot
    b: vec4<f32>,   // contrast: steepness, left diff, right diff, left slope diff
    c: vec4<f32>,   // contrast: right slope diff, pivot slope; highlight, shadow exponents
    d: vec4<f32>,   // black/white slope, bias; exposure
    on1: vec4<f32>, // temperature/tint, saturation, brightness, contrast
    on2: vec4<f32>, // highlights, shadows, black/white, exposure
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> A: AdjustParams;
// Exposure lookup table: 17 grids of 17x17 side by side (289x17), red across, green down,
// blue picks the grid.
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

// Bilinear lookup in one 17x17 grid at texel coordinates.
fn lut_grid(grid: f32, rg: vec2<f32>) -> vec3<f32> {
    let p = vec2<f32>(grid * 17.0 + rg.x * 16.0, rg.y * 16.0);
    let b = floor(p);
    let f = p - b;
    let i = vec2<i32>(b);
    let j = min(i + vec2<i32>(1, 1), vec2<i32>(i32(grid) * 17 + 16, 16));
    let top = mix(textureLoad(lut, i, 0).rgb, textureLoad(lut, vec2<i32>(j.x, i.y), 0).rgb, f.x);
    let bottom = mix(textureLoad(lut, vec2<i32>(i.x, j.y), 0).rgb, textureLoad(lut, j, 0).rgb, f.x);
    return mix(top, bottom, f.y);
}

fn lut3d(c: vec3<f32>) -> vec3<f32> {
    let blue = c.b * 16.0;
    return mix(lut_grid(floor(blue), c.rg), lut_grid(ceil(blue), c.rg), fract(blue));
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
    if (A.on2.w > 0.5) {
        c = clamp(mix(c, lut3d(c), abs(A.d.z)), zero, one);
    }
    return vec4<f32>(c * px.a, px.a);
}
