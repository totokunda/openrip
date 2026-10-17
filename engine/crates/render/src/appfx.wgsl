// The app's own clip filters (apps/app components/preview/webgl-filters), on a clip's own
// pixels after its masks: each pass as the app runs it, in its order, on straight colour,
// clamped between passes as its 8-bit canvases are. Distances are in the app's pixels (its
// working canvas is the clip fitted to a 600-unit-tall world), `P.step` stage pixels each.

struct AppParams {
    a: f32,
    b: f32,
    step: f32,
    seed: f32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: AppParams;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

fn load(p: vec2<i32>) -> vec4<f32> {
    let d = vec2<i32>(textureDimensions(src));
    return textureLoad(src, clamp(p, vec2<i32>(0), d - vec2<i32>(1)), 0);
}

fn bilinear(x: vec2<f32>) -> vec4<f32> {
    let p = x - vec2<f32>(0.5);
    let i = floor(p);
    let f = p - i;
    let a = vec2<i32>(i);
    let top = mix(load(a), load(a + vec2<i32>(1, 0)), f.x);
    let bottom = mix(load(a + vec2<i32>(0, 1)), load(a + vec2<i32>(1, 1)), f.x);
    return mix(top, bottom, f.y);
}

fn straight(px: vec4<f32>) -> vec3<f32> {
    return select(vec3<f32>(0.0), px.rgb / px.a, px.a > 0.0);
}

fn premul(c: vec3<f32>, a: f32) -> vec4<f32> {
    return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * a, a);
}

@fragment
fn fs_brightness(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = load(vec2<i32>(floor(pos.xy)));
    return premul(straight(px) + P.a, px.a);
}

@fragment
fn fs_contrast(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = load(vec2<i32>(floor(pos.xy)));
    return premul((straight(px) - 0.5) * (1.0 + P.a) + 0.5, px.a);
}

fn rgb2hsl(c: vec3<f32>) -> vec3<f32> {
    let hi = max(max(c.r, c.g), c.b);
    let lo = min(min(c.r, c.g), c.b);
    let d = hi - lo;
    var h = 0.0;
    var s = 0.0;
    let l = (hi + lo) / 2.0;
    if (d > 0.0001) {
        s = select(d / (2.0 - hi - lo), d / (hi + lo), l < 0.5);
        if (c.r >= hi) {
            h = (c.g - c.b) / d + select(0.0, 6.0, c.g < c.b);
        } else if (c.g >= hi) {
            h = (c.b - c.r) / d + 2.0;
        } else {
            h = (c.r - c.g) / d + 4.0;
        }
        h /= 6.0;
    }
    return vec3<f32>(h, s, l);
}

fn hue2rgb(p: f32, q: f32, t0: f32) -> f32 {
    var t = t0;
    if (t < 0.0) { t += 1.0; }
    if (t > 1.0) { t -= 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 0.5) { return q; }
    if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

@fragment
fn fs_huesat(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = load(vec2<i32>(floor(pos.xy)));
    var hsl = rgb2hsl(clamp(straight(px), vec3<f32>(0.0), vec3<f32>(1.0)));
    // GLSL mod: always in [0, 1).
    let h = hsl.x + P.a;
    hsl.x = h - floor(h);
    hsl.y = clamp(hsl.y * (1.0 + P.b), 0.0, 1.0);
    if (hsl.y == 0.0) {
        return premul(vec3<f32>(hsl.z), px.a);
    }
    let q = select(hsl.z + hsl.y - hsl.z * hsl.y, hsl.z * (1.0 + hsl.y), hsl.z < 0.5);
    let p = 2.0 * hsl.z - q;
    return premul(vec3<f32>(hue2rgb(p, q, hsl.x + 1.0 / 3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0 / 3.0)), px.a);
}

// Gaussian taps one app pixel apart, out to the radius (at most 10).
fn blur(pos: vec2<f32>, dir: vec2<f32>) -> vec4<f32> {
    let r = P.a;
    var sum = vec4<f32>(0.0);
    var total = 0.0;
    for (var x = -10.0; x <= 10.0; x += 1.0) {
        if (abs(x) > r) {
            continue;
        }
        let w = exp(-0.5 * (x * x) / (r * r * 0.15));
        sum += bilinear(pos + dir * x * P.step) * w;
        total += w;
    }
    return sum / total;
}

@fragment
fn fs_blur_h(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return blur(pos.xy, vec2<f32>(1.0, 0.0));
}

@fragment
fn fs_blur_v(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return blur(pos.xy, vec2<f32>(0.0, 1.0));
}

// Unsharp mask against a 3×3 binomial blur, strength × 5.
@fragment
fn fs_sharpen(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let s = P.step;
    let center = load(vec2<i32>(floor(pos.xy)));
    let blurred = (bilinear(pos.xy + vec2<f32>(-s, -s)) + 2.0 * bilinear(pos.xy + vec2<f32>(0.0, -s)) + bilinear(pos.xy + vec2<f32>(s, -s))
        + 2.0 * bilinear(pos.xy + vec2<f32>(-s, 0.0)) + 4.0 * center + 2.0 * bilinear(pos.xy + vec2<f32>(s, 0.0))
        + bilinear(pos.xy + vec2<f32>(-s, s)) + 2.0 * bilinear(pos.xy + vec2<f32>(0.0, s)) + bilinear(pos.xy + vec2<f32>(s, s))) / 16.0;
    let c = straight(center);
    let b = straight(blurred);
    return premul(c + P.a * 5.0 * (c - b), center.a);
}

// Fresh grain every frame, one value per app pixel.
@fragment
fn fs_noise(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = load(vec2<i32>(floor(pos.xy)));
    let cell = floor(pos.xy / P.step);
    let r = fract(sin(dot(cell, vec2<f32>(12.9898, 78.233)) + P.seed) * 43758.5453);
    return premul(straight(px) + (r - 0.5) * P.a, px.a);
}

@fragment
fn fs_vignette(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = load(vec2<i32>(floor(pos.xy)));
    let uv = pos.xy / vec2<f32>(textureDimensions(src));
    let d = length(uv - vec2<f32>(0.5)) / length(vec2<f32>(0.5));
    let falloff = clamp(1.0 - d * d * d * P.a * 2.0, 0.0, 1.0);
    return premul(straight(px) * falloff, px.a);
}
