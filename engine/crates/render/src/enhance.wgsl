// A clip's clean-up on its own picture, before it is resized or placed (Reduce image noise,
// Motion blur, Remove flickers). Two passes, both reading the picture premultiplied (video is
// opaque):
//
// 1. fs_temporal: the picture's brightness gain (Remove flickers); temporal averaging with the
//    frames before and after, each pixel only as far as that frame agrees with this one around
//    it (so moving things are left alone and noise, which differs from frame to frame, is
//    averaged away); then the neighbouring frames blended in by the motion-blur amount.
// 2. fs_spatial: an edge-preserving bilateral filter, for the noise the first pass can't reach
//    (where things move, and the first frame's own).

struct Params {
    // gain, motion blur amount, denoise strength, a frame before exists
    a: vec4<f32>,
    // a frame after exists, then unused
    b: vec4<f32>,
}

@group(0) @binding(0) var cur: texture_2d<f32>;
@group(0) @binding(1) var prev: texture_2d<f32>;
@group(0) @binding(2) var next: texture_2d<f32>;
@group(0) @binding(3) var<uniform> P: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

fn load(t: texture_2d<f32>, p: vec2<i32>) -> vec4<f32> {
    let d = vec2<i32>(textureDimensions(t));
    return textureLoad(t, clamp(p, vec2<i32>(0), d - vec2<i32>(1)), 0);
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// How much a neighbouring frame differs from this one around p: the mean absolute luma
// difference over the 3x3 window.
fn disagreement(other: texture_2d<f32>, p: vec2<i32>) -> f32 {
    var d = 0.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let o = vec2<i32>(x, y);
            d += abs(luma(load(other, p + o).rgb) - luma(load(cur, p + o).rgb));
        }
    }
    return d / 9.0;
}

@fragment
fn fs_temporal(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(frag.xy);
    let c = load(cur, p);
    let has_prev = P.a.w > 0.5;
    let has_next = P.b.x > 0.5;
    let strength = P.a.z;
    var col = c.rgb;
    var pc = col;
    var nc = col;
    if (has_prev) { pc = load(prev, p).rgb; }
    if (has_next) { nc = load(next, p).rgb; }
    if (strength > 0.0) {
        // Noise makes two frames differ by about 1.1x its own spread; more than this is motion.
        let tolerance = 0.05 + 0.10 * strength;
        var sum = c.rgb;
        var weight = 1.0;
        if (has_prev) {
            let d = disagreement(prev, p) / tolerance;
            let w = strength * exp(-d * d);
            sum += w * pc;
            weight += w;
        }
        if (has_next) {
            let d = disagreement(next, p) / tolerance;
            let w = strength * exp(-d * d);
            sum += w * nc;
            weight += w;
        }
        col = sum / weight;
    }
    let blur = P.a.y;
    if (blur > 0.0) {
        col = mix(col, 0.5 * (pc + nc), blur * 2.0 / 3.0);
    }
    return vec4<f32>(clamp(col * P.a.x, vec3<f32>(0.0), vec3<f32>(1.0)), c.a);
}

@fragment
fn fs_spatial(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(frag.xy);
    let c = load(cur, p);
    let strength = P.a.z;
    // Colours within this distance of the centre's count as the same surface.
    let range = 0.02 + 0.13 * strength;
    let inv = 1.0 / (2.0 * range * range);
    var sum = vec3<f32>(0.0);
    var weight = 0.0;
    for (var y = -3; y <= 3; y++) {
        for (var x = -3; x <= 3; x++) {
            let s = load(cur, p + vec2<i32>(x, y)).rgb;
            let d = s - c.rgb;
            let near = exp(-f32(x * x + y * y) / 8.0);
            let w = near * exp(-dot(d, d) * inv);
            sum += w * s;
            weight += w;
        }
    }
    return vec4<f32>(sum / weight, c.a);
}
