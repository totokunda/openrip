// CapCut's Clarity and Vignette, after its Adjust pass and Sharpen, on one clip's staged
// (premultiplied) pixels; parameters from grade.rs. Docs: docs/parity/colour.md.
//
// Clarity is a Laplacian pyramid of the picture's value (HSV): each level is the one above
// at half size, each detail band (a level minus the next one up-sampled) is strengthened
// where it's small, the bands are added back up from the smallest level, and the result
// becomes the value of the picture with its saturation raised, mixed in by the slider.

struct FinishParams {
    // The output's size in pixels.
    size: vec4<f32>,
    // Clarity: amount. Vignette: intensity, CapCut's eased parameter.
    k: vec4<f32>,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: FinishParams;
@group(0) @binding(2) var aux: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

fn straight(px: vec4<f32>) -> vec3<f32> {
    if (px.a <= 0.0) {
        return vec3<f32>(0.0);
    }
    return px.rgb / px.a;
}

// A level sampled as a GPU samples a texture bilinearly (clamped at the edges), at this
// output pixel's place: CapCut resizes its pyramid levels by drawing one into another.
fn sample_level(t: texture_2d<f32>, pos: vec2<f32>) -> f32 {
    let size = vec2<i32>(textureDimensions(t));
    let q = pos * vec2<f32>(size) / P.size.xy - 0.5;
    let b = floor(q);
    let f = q - b;
    let i0 = clamp(vec2<i32>(b), vec2<i32>(0), size - 1);
    let i1 = clamp(vec2<i32>(b) + 1, vec2<i32>(0), size - 1);
    let top = mix(textureLoad(t, i0, 0).r, textureLoad(t, vec2<i32>(i1.x, i0.y), 0).r, f.x);
    let bottom = mix(textureLoad(t, vec2<i32>(i0.x, i1.y), 0).r, textureLoad(t, i1, 0).r, f.x);
    return mix(top, bottom, f.y);
}

// CapCut's branchless RGB <-> HSV (hue 0..1).
fn rgb_to_hsv(c: vec3<f32>) -> vec3<f32> {
    let k = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4<f32>(c.bg, k.wz), vec4<f32>(c.gb, k.xy), step(c.b, c.g));
    let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
    let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
    return c.z * mix(k.xxx, clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// The pyramid's first level: the value (largest channel).
@fragment
fn fs_clarity_value(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let c = straight(textureLoad(src, vec2<i32>(floor(pos.xy)), 0));
    return vec4<f32>(max(c.r, max(c.g, c.b)), 0.0, 0.0, 1.0);
}

// The next level: this one at its own (half) size.
@fragment
fn fs_clarity_down(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(sample_level(src, pos.xy), 0.0, 0.0, 1.0);
}

// A detail band, strengthened by up to 55% where it's small (CapCut's `fact` 0.55, sigma
// 0.15): the level (`src`) minus the next one up (`aux`) at this size.
@fragment
fn fs_clarity_detail(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let d = textureLoad(src, vec2<i32>(floor(pos.xy)), 0).r - sample_level(aux, pos.xy);
    return vec4<f32>(d + 0.55 * d * exp(-d * d / (2.0 * 0.15 * 0.15)), 0.0, 0.0, 1.0);
}

// A level rebuilt: its band (`src`) plus the level below it rebuilt (`aux`), kept in 0..1.
@fragment
fn fs_clarity_add(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let v = textureLoad(src, vec2<i32>(floor(pos.xy)), 0).r + sample_level(aux, pos.xy);
    return vec4<f32>(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0);
}

// The picture with its HSV saturation times 1.12 (stored in 8 bits, as CapCut's pass is) and
// the rebuilt value (`aux`), mixed over the picture by the amount.
@fragment
fn fs_clarity_final(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let px = textureLoad(src, p, 0);
    if (px.a <= 0.0) {
        return px;
    }
    let c = px.rgb / px.a;
    var sat = rgb_to_hsv(c);
    sat.y *= 1.12;
    let stored = round(clamp(hsv_to_rgb(sat), vec3<f32>(0.0), vec3<f32>(1.0)) * 255.0) / 255.0;
    var hsv = rgb_to_hsv(stored);
    hsv.z = textureLoad(aux, p, 0).r;
    let out = clamp(mix(c, hsv_to_rgb(hsv), P.k.x), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(out * px.a, px.a);
}

// CapCut's vignette over the clip's own picture: darkening towards black (intensity above 0)
// or lightening towards white (below), by distance from the middle in half-sizes.
@fragment
fn fs_vignette(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = textureLoad(src, vec2<i32>(floor(pos.xy)), 0);
    if (px.a <= 0.0) {
        return px;
    }
    var c = px.rgb / px.a;
    let uv = 2.0 * pos.xy / P.size.xy - 1.0;
    let dist = length(uv);
    let sqrt2 = 1.415;
    let intensity = P.k.x;
    let param = abs(P.k.y);
    if (intensity >= 0.0001) {
        let w = smoothstep(mix(1.0, 0.1, param) * sqrt2, mix(1.4, 0.85, param) * sqrt2, dist);
        c = mix(c, vec3<f32>(0.0), w);
    } else {
        let w = smoothstep(mix(1.0, 0.2, abs(intensity)) * sqrt2, mix(1.5, 0.9, param) * sqrt2, dist);
        c = mix(c, vec3<f32>(1.0), w);
    }
    return vec4<f32>(c * px.a, px.a);
}

// The Particles slider: film grain. Each grain cell (a pixel or a few) gets a random value
// from a hash of its place and the frame's seed (three taps averaged, so it is bell-shaped),
// added to the picture as luminance noise with a little colour in it, most in the midtones
// and fading in near-black and near-white as a film's does. Written for OpenRip.
fn hash3(p: vec3<f32>) -> f32 {
    var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

@fragment
fn fs_particles(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = textureLoad(src, vec2<i32>(floor(pos.xy)), 0);
    if (px.a <= 0.0) {
        return px;
    }
    let c = px.rgb / px.a;
    let cell = floor(pos.xy / P.k.z);
    let seed = P.k.y;
    let g = (hash3(vec3<f32>(cell, seed)) + hash3(vec3<f32>(cell + 17.0, seed + 3.0)) + hash3(vec3<f32>(cell + 41.0, seed + 7.0))) / 3.0 - 0.5;
    let tint = vec3<f32>(hash3(vec3<f32>(cell + 5.0, seed + 11.0)), hash3(vec3<f32>(cell + 9.0, seed + 13.0)), hash3(vec3<f32>(cell + 23.0, seed + 19.0))) - 0.5;
    let y = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    let weight = 1.0 - pow(abs(2.0 * y - 1.0), 3.0) * 0.8;
    let noise = (vec3<f32>(g) + tint * 0.25) * P.k.x * 0.5 * weight;
    let out = clamp(c + noise, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(out * px.a, px.a);
}
