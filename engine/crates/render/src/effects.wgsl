// OpenRip's own video effects (openrip_model::fx lists them): one pass over everything drawn
// so far on the canvas, or in a clip's group (effects.rs). Every effect is written for
// OpenRip from scratch in this file (hash and noise helpers are the usual textbook ones); no
// third-party shader code is used.
//
// `src` holds premultiplied RGBA. Each effect works from the pixel's own colour, or samples
// the picture elsewhere, and returns premultiplied RGBA too. The strength `k` runs 0…1 (at 0
// the pass isn't run at all), `a`, `b`, `c` are the effect's own parameters (0…1), `t` is the
// time in seconds since the effect began and `prog` how far through its duration it is.

struct FX {
    kind: f32,
    k: f32,
    a: f32,
    b: f32,
    c: f32,
    t: f32,
    prog: f32,
    seed: f32,
    size: vec2<f32>,
    // 1 on the frame's canvas (always opaque), 0 in a clip's own group.
    opaque: f32,
    pad: f32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> F: FX;

const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

// ---- helpers ------------------------------------------------------------------------------

fn aspect() -> f32 {
    return F.size.x / F.size.y;
}

fn px(p: vec2<i32>) -> vec4<f32> {
    let d = vec2<i32>(textureDimensions(src));
    return textureLoad(src, clamp(p, vec2<i32>(0), d - vec2<i32>(1)), 0);
}

/// The picture at `uv` (0…1), bilinear, edges held.
fn tex(uv: vec2<f32>) -> vec4<f32> {
    let d = vec2<f32>(textureDimensions(src));
    let p = uv * d - 0.5;
    let i = floor(p);
    let f = p - i;
    let ii = vec2<i32>(i);
    return mix(mix(px(ii), px(ii + vec2<i32>(1, 0)), f.x), mix(px(ii + vec2<i32>(0, 1)), px(ii + vec2<i32>(1, 1)), f.x), f.y);
}

/// The picture at `uv`, clear outside it.
fn texz(uv: vec2<f32>) -> vec4<f32> {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4<f32>(0.0);
    }
    return tex(uv);
}

fn mirror(x: f32) -> f32 {
    return 1.0 - abs(fract(x * 0.5) * 2.0 - 1.0);
}

/// The picture at `uv`, mirrored past its edges.
fn texm(uv: vec2<f32>) -> vec4<f32> {
    return tex(vec2<f32>(mirror(uv.x), mirror(uv.y)));
}

fn lum(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn straight(c: vec4<f32>) -> vec3<f32> {
    return c.rgb / max(c.a, 0.0001);
}

/// `c` with its colour replaced by `rgb` (straight), keeping its alpha.
fn put(c: vec4<f32>, rgb: vec3<f32>) -> vec4<f32> {
    return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * c.a, c.a);
}

fn screen(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(1.0) - (vec3<f32>(1.0) - a) * (vec3<f32>(1.0) - clamp(b, vec3<f32>(0.0), vec3<f32>(1.0)));
}

fn h11(x: f32) -> f32 {
    return fract(sin(x * 127.1 + 311.7) * 43758.5453);
}

fn h21(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn h22(p: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(h21(p), h21(p + vec2<f32>(17.31, 5.17)));
}

fn vnoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2<f32>(1.0, 0.0)), u.x), mix(h21(i + vec2<f32>(0.0, 1.0)), h21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

fn rot2(p: vec2<f32>, a: f32) -> vec2<f32> {
    let s = sin(a);
    let c = cos(a);
    return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn hsv(h: f32, s: f32, v: f32) -> vec3<f32> {
    let k = vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0);
    let p = abs(fract(vec3<f32>(h) + k) * 6.0 - vec3<f32>(3.0));
    return v * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), s);
}

/// A blur of radius `r` (canvas heights) over 24 taps in a spiral.
fn blur_at(uv: vec2<f32>, r: f32) -> vec4<f32> {
    var acc = vec4<f32>(0.0);
    for (var i = 0; i < 24; i++) {
        let fi = f32(i);
        let rad = sqrt((fi + 0.5) / 24.0);
        let ang = fi * 2.39996;
        let o = vec2<f32>(cos(ang), sin(ang)) * rad * r;
        acc += tex(uv + vec2<f32>(o.x / aspect(), o.y));
    }
    return acc / 24.0;
}

/// What the bright parts of the picture spread to within radius `r`.
fn bright_spread(uv: vec2<f32>, r: f32, threshold: f32) -> vec3<f32> {
    var acc = vec3<f32>(0.0);
    for (var i = 0; i < 24; i++) {
        let fi = f32(i);
        let rad = sqrt((fi + 0.5) / 24.0);
        let ang = fi * 2.39996;
        let o = vec2<f32>(cos(ang), sin(ang)) * rad * r;
        let s = tex(uv + vec2<f32>(o.x / aspect(), o.y));
        acc += max(straight(s) - vec3<f32>(threshold), vec3<f32>(0.0)) * s.a;
    }
    return acc / 24.0;
}

fn edge_at(uv: vec2<f32>) -> f32 {
    let o = vec2<f32>(1.0 / F.size.x, 1.0 / F.size.y) * max(1.0, F.size.y / 720.0);
    let l = lum(straight(tex(uv + vec2<f32>(-o.x, 0.0))));
    let r = lum(straight(tex(uv + vec2<f32>(o.x, 0.0))));
    let u = lum(straight(tex(uv + vec2<f32>(0.0, -o.y))));
    let d = lum(straight(tex(uv + vec2<f32>(0.0, o.y))));
    let ul = lum(straight(tex(uv + vec2<f32>(-o.x, -o.y))));
    let dr = lum(straight(tex(uv + vec2<f32>(o.x, o.y))));
    let ur = lum(straight(tex(uv + vec2<f32>(o.x, -o.y))));
    let dl = lum(straight(tex(uv + vec2<f32>(-o.x, o.y))));
    let gx = (ur + 2.0 * r + dr) - (ul + 2.0 * l + dl);
    let gy = (dl + 2.0 * d + dr) - (ul + 2.0 * u + ur);
    return length(vec2<f32>(gx, gy));
}

// ---- Basic --------------------------------------------------------------------------------

fn e_blur(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    return blur_at(uv, F.k * 0.05);
}

fn e_zoom(uv: vec2<f32>, z: f32) -> vec4<f32> {
    return tex((uv - vec2<f32>(0.5)) / z + vec2<f32>(0.5));
}

fn e_shake(uv: vec2<f32>) -> vec4<f32> {
    let f = 8.0 + F.a * 40.0;
    let t = F.t * f;
    let off = vec2<f32>(sin(t * 1.3 + 1.7) + sin(t * 2.9), cos(t * 1.1) + sin(t * 3.3 + 0.5)) * 0.5 * F.k * 0.03;
    return tex((uv - vec2<f32>(0.5)) / (1.0 + F.k * 0.07) + vec2<f32>(0.5) + off);
}

fn e_flash(c: vec4<f32>) -> vec4<f32> {
    let f = 0.5 + F.a * 4.0;
    let pulse = pow(1.0 - fract(F.t * f), 3.0);
    return put(c, mix(straight(c), vec3<f32>(1.0), F.k * pulse));
}

fn e_strobe(c: vec4<f32>) -> vec4<f32> {
    let on = step(0.5, fract(F.t * (2.0 + F.a * 14.0)));
    return put(c, mix(straight(c), vec3<f32>(F.b), F.k * on));
}

fn e_fade(c: vec4<f32>, shade: f32, weight: f32) -> vec4<f32> {
    return put(c, mix(straight(c), vec3<f32>(shade), clamp(F.k * weight, 0.0, 1.0)));
}

fn e_vignette_pulse(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let d = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0);
    let v = smoothstep(0.25, 0.95, length(d));
    let pulse = 0.5 + 0.5 * sin(F.t * (1.0 + F.a * 6.0) * TAU * 0.5);
    return put(c, straight(c) * (1.0 - F.k * v * (0.35 + 0.65 * pulse)));
}

fn e_mosaic(pos: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let bs = floor(1.0 + F.k * F.size.y * 0.06);
    let p = floor(pos / bs) * bs + vec2<f32>(bs * 0.5);
    return tex(p / F.size);
}

fn e_mono(c: vec4<f32>) -> vec4<f32> {
    let s = straight(c);
    return put(c, mix(s, vec3<f32>(lum(s)), F.k));
}

fn e_invert(c: vec4<f32>) -> vec4<f32> {
    let s = straight(c);
    return put(c, mix(s, vec3<f32>(1.0) - s, F.k));
}

fn e_sepia(c: vec4<f32>) -> vec4<f32> {
    let s = straight(c);
    let sep = vec3<f32>(dot(s, vec3<f32>(0.393, 0.769, 0.189)), dot(s, vec3<f32>(0.349, 0.686, 0.168)), dot(s, vec3<f32>(0.272, 0.534, 0.131)));
    return put(c, mix(s, sep, F.k));
}

fn e_comic(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let s = straight(c);
    let n = mix(255.0, 5.0, F.k);
    let q = floor(s * n + vec3<f32>(0.5)) / n;
    let ink = smoothstep(0.35, 0.9, edge_at(uv)) * F.k;
    return put(c, mix(q, vec3<f32>(0.0), ink));
}

fn e_sketch(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let s = straight(c);
    let line = 1.0 - clamp(edge_at(uv) * 2.2, 0.0, 1.0);
    let paper = vec3<f32>(0.97, 0.96, 0.93) * (0.55 + 0.45 * lum(s));
    return put(c, mix(s, paper * line, F.k));
}

// ---- Retro --------------------------------------------------------------------------------

fn e_scanlines(pos: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let period = (2.0 + F.a * 6.0) * max(1.0, F.size.y / 1080.0);
    let line = 0.5 + 0.5 * sin(pos.y / period * TAU);
    return put(c, straight(c) * (1.0 - F.k * 0.55 * (1.0 - line)));
}

fn e_tracking(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let y0 = fract(F.t * (0.08 + F.a * 0.5));
    let hgt = 0.06 + F.b * 0.14;
    let inband = smoothstep(y0 - hgt, y0 - hgt * 0.5, uv.y) * (1.0 - smoothstep(y0 + hgt * 0.5, y0 + hgt, uv.y));
    let slot = floor(F.t * 30.0);
    let row = floor(uv.y * 240.0);
    let off = (h21(vec2<f32>(row, slot)) - 0.5) * 0.12 * F.k * inband;
    let shift = (vnoise(vec2<f32>(F.t * 8.0, 3.0)) - 0.5) * 0.004 * F.k;
    var o = tex(uv + vec2<f32>(off + shift, 0.0));
    let speck = step(0.93, h21(vec2<f32>(floor(uv.x * 400.0), row + slot))) * inband * F.k;
    o = vec4<f32>(o.rgb + vec3<f32>(speck * 0.6) * o.a, o.a);
    return o;
}

fn e_colour_bleed(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let d = F.k * 0.014;
    var r = 0.0;
    var b = 0.0;
    for (var i = 0; i < 8; i++) {
        let f = f32(i) / 7.0;
        r += tex(uv + vec2<f32>(-d * f, 0.0)).r;
        b += tex(uv + vec2<f32>(d * f, 0.0)).b;
    }
    return vec4<f32>(r / 8.0, c.g, b / 8.0, c.a);
}

fn e_film_grain(pos: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let cell = floor(pos / (1.0 + F.a * 2.0 * max(1.0, F.size.y / 1080.0)));
    let n = h21(cell + vec2<f32>(floor(F.t * 24.0) * 37.1, floor(F.t * 24.0) * 11.3)) - 0.5;
    let s = straight(c);
    let w = 1.0 - abs(lum(s) - 0.5) * 0.8;
    return put(c, s + vec3<f32>(n * F.k * 0.45 * w));
}

fn scratch_amount(uv: vec2<f32>, amount: f32) -> vec2<f32> {
    // x: light marks (dust and scratches), y: dark marks.
    let frame = floor(F.t * 12.0);
    var light = 0.0;
    var dark = 0.0;
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let x = h21(vec2<f32>(frame * 7.3 + fi, 1.0));
        let on = step(1.0 - amount * 0.7, h21(vec2<f32>(frame + fi * 13.0, 5.0)));
        let wob = vnoise(vec2<f32>(uv.y * 6.0 + fi * 10.0, frame)) * 0.004;
        light += on * (1.0 - smoothstep(0.0, 0.0012, abs(uv.x - x - wob))) * step(0.15, h21(vec2<f32>(floor(uv.y * 8.0), frame + fi)));
    }
    let cells = vec2<f32>(40.0 * aspect() / 1.78, 24.0);
    let gp = uv * cells;
    let id = floor(gp);
    let at = h22(id + vec2<f32>(frame * 3.1, 2.0));
    let d = length((fract(gp) - at) * vec2<f32>(1.0, 1.0));
    let present = step(1.0 - amount * 0.25, h21(id + vec2<f32>(frame, 9.0)));
    let size = 0.05 + 0.1 * h21(id + 3.0);
    let speck = present * (1.0 - smoothstep(size * 0.6, size, d));
    if (h21(id + vec2<f32>(7.0, frame)) > 0.5) {
        light += speck;
    } else {
        dark += speck;
    }
    return vec2<f32>(light, dark);
}

fn e_dust(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let m = scratch_amount(uv, F.a);
    let s = straight(c);
    return put(c, mix(mix(s, vec3<f32>(0.92), clamp(m.x, 0.0, 1.0) * F.k), vec3<f32>(0.03), clamp(m.y, 0.0, 1.0) * F.k));
}

fn e_old_film(uv: vec2<f32>, pos: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    var s = straight(c);
    let sep = vec3<f32>(dot(s, vec3<f32>(0.393, 0.769, 0.189)), dot(s, vec3<f32>(0.349, 0.686, 0.168)), dot(s, vec3<f32>(0.272, 0.534, 0.131)));
    s = mix(s, sep, 0.85 * F.k);
    let flick = 1.0 + (h11(floor(F.t * 18.0)) - 0.5) * 0.25 * F.k;
    s = s * flick;
    let n = h21(pos + vec2<f32>(floor(F.t * 24.0) * 31.7, 3.0)) - 0.5;
    s = s + vec3<f32>(n * 0.25 * F.k);
    let d = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0);
    s = s * (1.0 - F.k * 0.6 * smoothstep(0.3, 0.95, length(d)));
    let m = scratch_amount(uv, 0.6);
    s = mix(mix(s, vec3<f32>(0.9), clamp(m.x, 0.0, 1.0) * F.k), vec3<f32>(0.03), clamp(m.y, 0.0, 1.0) * F.k);
    return put(c, s);
}

fn e_crt(uv: vec2<f32>, pos: vec2<f32>) -> vec4<f32> {
    let d = uv - vec2<f32>(0.5);
    let r2 = dot(d * vec2<f32>(aspect(), 1.0), d * vec2<f32>(aspect(), 1.0));
    let u2 = vec2<f32>(0.5) + d * (1.0 + F.k * 0.18 * r2);
    if (u2.x < 0.0 || u2.x > 1.0 || u2.y < 0.0 || u2.y > 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    let ca = F.k * 0.0015;
    let r = tex(u2 + vec2<f32>(ca, 0.0)).r;
    let g = tex(u2).g;
    let b = tex(u2 - vec2<f32>(ca, 0.0)).b;
    var rgb = vec3<f32>(r, g, b);
    let line = 0.5 + 0.5 * sin(u2.y * F.size.y * PI * 0.9);
    rgb = rgb * (1.0 - F.k * 0.35 * (1.0 - line));
    let mask = 0.5 + 0.5 * sin(u2.x * F.size.x * PI * 0.66 + vec3<f32>(0.0, 2.09, 4.19));
    rgb = rgb * (1.0 - F.k * 0.12 * (1.0 - mask));
    rgb = rgb * (1.0 - F.k * 0.7 * smoothstep(0.25, 0.8, r2 * 1.6));
    rgb = rgb * (1.0 + F.k * 0.15);
    return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

fn e_tape_jitter(uv: vec2<f32>) -> vec4<f32> {
    let slot = floor(F.t * 20.0);
    let row = floor(uv.y * 270.0);
    let burst = step(0.88, h21(vec2<f32>(floor(uv.y * 20.0), slot)));
    let off = (h21(vec2<f32>(row, slot)) - 0.5) * 0.03 * burst * F.k;
    let bottom = smoothstep(0.88, 1.0, uv.y) * (vnoise(vec2<f32>(F.t * 10.0, uv.y * 40.0)) - 0.3) * 0.05 * F.k;
    return tex(uv + vec2<f32>(off + bottom, 0.0));
}

fn e_flicker(c: vec4<f32>) -> vec4<f32> {
    let m = 1.0 + (h11(floor(F.t * (6.0 + F.a * 18.0))) - 0.5) * 0.7 * F.k;
    return put(c, straight(c) * m);
}

// ---- Glitch -------------------------------------------------------------------------------

fn e_rgb_split(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let d = F.k * 0.025 * (0.3 + F.a);
    let ang = F.b * TAU + sin(F.t * 7.0) * 0.1;
    let o = vec2<f32>(cos(ang) / aspect(), sin(ang)) * d;
    return vec4<f32>(tex(uv + o).r, c.g, tex(uv - o).b, c.a);
}

fn e_block_glitch(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let cell = floor(uv * vec2<f32>(10.0, 18.0));
    let slot = floor(F.t * (3.0 + F.a * 12.0));
    let hh = h21(cell + vec2<f32>(slot * 5.3, slot * 1.7));
    if (hh > F.k * 0.45) {
        return c;
    }
    let off = (h22(cell + vec2<f32>(slot, 3.0)) - vec2<f32>(0.5)) * 0.25;
    var o = tex(uv + off);
    let tint = step(0.5, h21(cell + vec2<f32>(slot, 8.0)));
    if (tint > 0.5) {
        o = vec4<f32>(o.g, o.b, o.r, o.a);
    }
    return o;
}

fn e_pixel_sort(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let row = floor(uv.y * 90.0);
    let slot = floor(F.t * (1.0 + F.a * 6.0));
    let act = step(h21(vec2<f32>(row, slot)), F.k * 0.6);
    let len = (0.05 + F.b * 0.45) * (0.4 + h21(vec2<f32>(row + 3.0, slot)));
    var best = c;
    var bl = lum(straight(c));
    for (var i = 1; i <= 14; i++) {
        let o = f32(i) / 14.0 * len;
        let s = tex(vec2<f32>(uv.x - o, uv.y));
        let l = lum(straight(s));
        if (l > bl) {
            best = s;
            bl = l;
        }
    }
    return mix(c, best, act);
}

fn e_smear(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let cell = floor(uv * vec2<f32>(16.0, 9.0));
    let slot = floor(F.t * (1.0 + F.a * 5.0));
    let hh = h21(cell + vec2<f32>(slot * 13.7, 1.3));
    if (hh > F.k * 0.5) {
        return c;
    }
    let mv = (h22(cell + vec2<f32>(slot * 3.1, 7.0)) - vec2<f32>(0.5)) * 0.35;
    var acc = vec4<f32>(0.0);
    for (var i = 0; i < 8; i++) {
        acc += tex(uv - mv * (f32(i) / 7.0));
    }
    return acc / 8.0;
}

fn e_slice_glitch(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let r = floor(uv.y * 28.0);
    let slot = floor(F.t * (2.0 + F.a * 10.0));
    let on = step(1.0 - F.k * 0.45, h21(vec2<f32>(r, slot)));
    let off = (h21(vec2<f32>(r + 9.0, slot)) - 0.5) * 0.3 * on;
    return vec4<f32>(tex(uv + vec2<f32>(off * 1.3, 0.0)).r, tex(uv + vec2<f32>(off, 0.0)).g, tex(uv + vec2<f32>(off * 0.7, 0.0)).b, mix(c.a, tex(uv + vec2<f32>(off, 0.0)).a, on));
}

fn e_digital_noise(pos: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let block = floor(pos / (6.0 * max(1.0, F.size.y / 1080.0)));
    let slot = floor(F.t * (4.0 + F.a * 16.0));
    let n = h21(block + vec2<f32>(slot * 7.7, 1.0));
    let act = step(1.0 - F.k * 0.08, n);
    let col = vec3<f32>(h21(block + vec2<f32>(1.1, slot)), h21(block + vec2<f32>(2.2, slot)), h21(block + vec2<f32>(3.3, slot)));
    return put(c, mix(straight(c), col, act));
}

fn e_static(pos: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let n = h21(pos + vec2<f32>(fract(F.t) * 1000.0, fract(F.t * 3.7) * 700.0));
    return put(c, mix(straight(c), vec3<f32>(n), F.k * 0.6));
}

fn e_channel_swap(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let slot = floor(F.t * (2.0 + F.a * 8.0));
    let band = step(abs(uv.y - h11(slot)), 0.1 + 0.2 * F.k);
    let act = step(h11(slot * 3.7), F.k * 0.8) * band;
    let o = tex(uv + vec2<f32>(0.01 * act, 0.0));
    return mix(c, vec4<f32>(o.g, o.b, o.r, o.a), act);
}

// ---- Light --------------------------------------------------------------------------------

fn leak(uv: vec2<f32>, c: vec4<f32>, col_a: vec3<f32>, col_b: vec3<f32>) -> vec4<f32> {
    let speed = 0.2 + F.a * 1.5;
    var l = 0.0;
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let ph = F.t * speed * (0.3 + 0.2 * fi) + fi * 2.1;
        let p = vec2<f32>(0.5 + 0.6 * sin(ph * 0.9 + fi), 0.5 + 0.5 * cos(ph * 0.7 + fi * 1.7));
        let d = length((uv - p) * vec2<f32>(aspect(), 1.0));
        l += exp(-d * d * (2.5 + fi * 1.5));
    }
    let col = mix(col_a, col_b, clamp(uv.x + 0.3 * sin(F.t * speed), 0.0, 1.0));
    return put(c, screen(straight(c), col * clamp(l, 0.0, 1.3) * F.k * 1.1));
}

fn e_leak_prism(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let speed = 0.2 + F.a * 1.2;
    let band = 1.0 - smoothstep(0.0, 0.35, abs(uv.x * 0.8 + uv.y * 0.6 - fract(F.t * speed * 0.1) * 2.0 + 0.3));
    let col = hsv(fract(uv.x * 0.5 + uv.y * 0.3 + F.t * speed * 0.2), 0.8, 1.0);
    return put(c, screen(straight(c), col * band * F.k * 0.9));
}

fn ring(d: f32, r: f32, w: f32) -> f32 {
    let x = (d - r) / w;
    return exp(-x * x);
}

fn e_lens_flare(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let asp = vec2<f32>(aspect(), 1.0);
    let sun = vec2<f32>(0.1 + 0.8 * F.a, 0.28 + 0.06 * sin(F.t * 0.6));
    let sz = 0.5 + F.b;
    let to = (vec2<f32>(0.5) - sun);
    var add = vec3<f32>(0.0);
    let d0 = length((uv - sun) * asp);
    add += vec3<f32>(1.0, 0.85, 0.6) * (exp(-d0 * d0 * 90.0 / (sz * sz)) * 1.4 + exp(-d0 * 6.0) * 0.25);
    add += vec3<f32>(1.0, 0.8, 0.5) * exp(-abs(uv.y - sun.y) * 70.0) * exp(-abs(uv.x - sun.x) * 2.5) * 0.5;
    for (var i = 0; i < 4; i++) {
        let fi = f32(i);
        let m = 0.45 + fi * 0.45;
        let p = sun + to * m;
        let d = length((uv - p) * asp);
        let rr = (0.05 + 0.04 * fi) * sz;
        let col = hsv(fract(0.08 + fi * 0.2), 0.55, 1.0);
        add += col * (ring(d, rr, 0.012) * 0.5 + exp(-d * d / (rr * rr) * 1.5) * 0.18);
    }
    return put(c, screen(straight(c), add * F.k));
}

fn e_glow(uv: vec2<f32>, c: vec4<f32>, amount: f32) -> vec4<f32> {
    let g = bright_spread(uv, 0.012 + F.a * 0.06, 0.5);
    return put(c, screen(straight(c), g * amount * 2.4));
}

fn e_sparkle(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let n = 10.0 + F.b * 14.0;
    let gp = uv * vec2<f32>(n * aspect(), n);
    let id = floor(gp);
    let local = fract(gp) - vec2<f32>(0.5);
    let exist = step(1.0 - (0.12 + F.b * 0.4), h21(id));
    let d = local - (h22(id + vec2<f32>(4.0, 1.0)) - vec2<f32>(0.5)) * 0.5;
    let tw = pow(max(0.0, sin(F.t * (1.0 + F.a * 5.0) * (0.5 + h21(id + vec2<f32>(2.0, 2.0))) + h21(id + vec2<f32>(9.0, 3.0)) * TAU)), 6.0);
    let star = exp(-abs(d.x) * 45.0) * exp(-abs(d.y) * 4.0) + exp(-abs(d.y) * 45.0) * exp(-abs(d.x) * 4.0) + exp(-dot(d, d) * 160.0) * 1.2;
    return put(c, straight(c) + vec3<f32>(1.0, 0.97, 0.9) * star * tw * exist * F.k * 1.2);
}

fn e_dream(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let bl = straight(blur_at(uv, 0.014));
    let s = straight(c);
    var o = mix(s, bl, 0.55 * F.k);
    o = screen(o, bright_spread(uv, 0.03, 0.55) * F.k * 1.6);
    o = o + vec3<f32>(0.07 * F.k);
    return put(c, mix(o, vec3<f32>(lum(o)), -0.12 * F.k));
}

fn e_sun_rays(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let sun = vec2<f32>(0.1 + F.a * 0.8, 0.12);
    var acc = vec3<f32>(0.0);
    var w = 1.0;
    for (var i = 0; i < 24; i++) {
        let s = tex(mix(uv, sun, f32(i) / 24.0 * 0.7));
        let sc = straight(s);
        acc += max(sc - vec3<f32>(0.6), vec3<f32>(0.0)) * s.a * w;
        w *= 0.93;
    }
    return put(c, screen(straight(c), acc / 12.0 * vec3<f32>(1.0, 0.9, 0.7) * F.k * 2.0));
}

fn e_streak(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let len = 0.05 + F.a * 0.35;
    var acc = vec3<f32>(0.0);
    for (var i = -12; i <= 12; i++) {
        let f = f32(i) / 12.0;
        let s = tex(uv + vec2<f32>(f * len, 0.0));
        acc += max(straight(s) - vec3<f32>(0.65), vec3<f32>(0.0)) * s.a * (1.0 - abs(f));
    }
    return put(c, screen(straight(c), acc / 8.0 * vec3<f32>(0.55, 0.75, 1.0) * F.k * 2.2));
}

// ---- Lens ---------------------------------------------------------------------------------

fn corner_r2(uv: vec2<f32>) -> f32 {
    let d = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0);
    return dot(d, d) / (0.25 * (aspect() * aspect() + 1.0));
}

fn e_fisheye(uv: vec2<f32>) -> vec4<f32> {
    let d = uv - vec2<f32>(0.5);
    let r2 = corner_r2(uv);
    return texz(vec2<f32>(0.5) + d * (1.0 + F.k * 0.7 * r2) / (1.0 + F.k * 0.2));
}

fn e_pinch(uv: vec2<f32>) -> vec4<f32> {
    let d = uv - vec2<f32>(0.5);
    return tex(vec2<f32>(0.5) + d * (1.0 - F.k * 0.45 * corner_r2(uv)));
}

fn e_magnify(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let centre = vec2<f32>(0.5) + vec2<f32>(0.18 * sin(F.t * 0.7), 0.1 * cos(F.t * 0.9));
    let radius = 0.12 + F.a * 0.28;
    let dd = (uv - centre) * vec2<f32>(aspect(), 1.0);
    let r = length(dd);
    if (r >= radius) {
        let rim = (1.0 - smoothstep(radius, radius + 0.006, r)) * F.k;
        return put(c, mix(straight(c), vec3<f32>(1.0), rim * 0.0));
    }
    let q = r / radius;
    let o = tex(centre + (uv - centre) * (1.0 - F.k * 0.6 * (1.0 - q * q)));
    let rim = smoothstep(radius - 0.008, radius, r) * F.k;
    return put(o, straight(o) * (1.0 - rim * 0.5) + vec3<f32>(rim * 0.3));
}

fn e_chroma_aberration(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let d = uv - vec2<f32>(0.5);
    let amt = F.k * 0.03;
    return vec4<f32>(tex(vec2<f32>(0.5) + d * (1.0 + amt)).r, c.g, tex(vec2<f32>(0.5) + d * (1.0 - amt)).b, c.a);
}

fn e_tilt_shift(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let dist = max(0.0, abs(uv.y - F.a) - (0.04 + F.b * 0.3));
    let amt = smoothstep(0.0, 0.4, dist);
    let o = blur_at(uv, amt * F.k * 0.035);
    let s = straight(o);
    return put(o, mix(s, mix(vec3<f32>(lum(s)), s, 1.25), F.k * 0.6));
}

fn e_mirror(uv: vec2<f32>, c: vec4<f32>, horizontal: bool) -> vec4<f32> {
    var p = uv;
    if (horizontal) {
        p.x = select(uv.x, 1.0 - uv.x, uv.x > 0.5);
    } else {
        p.y = select(uv.y, 1.0 - uv.y, uv.y > 0.5);
    }
    return mix(c, tex(p), F.k);
}

fn e_kaleidoscope(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let p = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0);
    let ang = atan2(p.y, p.x) + F.t * F.b * 1.2;
    let r = length(p);
    let n = 3.0 + floor(F.a * 8.0);
    let seg = TAU / n;
    let m = abs(ang - seg * floor(ang / seg) - seg * 0.5);
    let q = r * vec2<f32>(cos(m), sin(m));
    return mix(c, texm(q / vec2<f32>(aspect(), 1.0) + vec2<f32>(0.5)), F.k);
}

fn e_split(uv: vec2<f32>, c: vec4<f32>, cols: f32, rows: f32) -> vec4<f32> {
    return mix(c, tex(vec2<f32>(fract(uv.x * cols), fract(uv.y * rows))), F.k);
}

fn e_swirl(uv: vec2<f32>) -> vec4<f32> {
    let d = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0);
    let r = length(d);
    let ang = F.k * 3.5 * (1.0 - smoothstep(0.0, 0.65, r));
    return tex(rot2(d, ang) / vec2<f32>(aspect(), 1.0) + vec2<f32>(0.5));
}

fn e_ripple(uv: vec2<f32>) -> vec4<f32> {
    let d = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0);
    let r = length(d);
    let dir = d / max(r, 0.0001);
    let off = dir * sin(r * 45.0 - F.t * (2.0 + F.a * 10.0)) * F.k * 0.012;
    return tex(uv + off / vec2<f32>(aspect(), 1.0));
}

fn e_zoom_blur(uv: vec2<f32>) -> vec4<f32> {
    var acc = vec4<f32>(0.0);
    for (var i = 0; i < 16; i++) {
        acc += tex(uv + (vec2<f32>(0.5) - uv) * (f32(i) / 15.0) * F.k * 0.25);
    }
    return acc / 16.0;
}

fn e_prism(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let o = F.k * 0.03 * vec2<f32>(1.0 / aspect() * 1.4, 0.5);
    let a = tex(uv + o);
    let b = tex(uv - o);
    let s = (straight(c) + straight(a) * vec3<f32>(1.0, 0.55, 0.9) + straight(b) * vec3<f32>(0.55, 0.9, 1.0)) / 2.1;
    return put(c, mix(straight(c), s * 1.15, F.k));
}

// ---- Party --------------------------------------------------------------------------------

fn e_rainbow(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let h = fract(uv.x * 0.8 + uv.y * 0.4 + F.t * (0.05 + F.a * 0.5));
    let tint = hsv(h, 0.85, 1.0);
    let s = straight(c);
    let tl = tint * (lum(s) / max(lum(tint), 0.25));
    return put(c, mix(s, tl, F.k * 0.7));
}

fn e_colour_cycle(c: vec4<f32>) -> vec4<f32> {
    let s = straight(c);
    let y = 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
    var i = 0.596 * s.r - 0.274 * s.g - 0.322 * s.b;
    var q = 0.211 * s.r - 0.523 * s.g + 0.312 * s.b;
    let a = F.t * (0.3 + F.a * 3.0);
    let ni = i * cos(a) - q * sin(a);
    let nq = i * sin(a) + q * cos(a);
    i = ni;
    q = nq;
    let o = vec3<f32>(y + 0.956 * i + 0.621 * q, y - 0.272 * i - 0.647 * q, y - 1.106 * i + 1.703 * q);
    return put(c, mix(s, o, F.k));
}

fn e_beat_flash(c: vec4<f32>) -> vec4<f32> {
    let ph = fract(F.t * (70.0 + F.a * 110.0) / 60.0);
    let kick = exp(-ph * 7.0);
    return put(c, straight(c) * (1.0 + F.k * kick * 0.8) + vec3<f32>(F.k * kick * 0.12));
}

fn e_disco(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    var add = vec3<f32>(0.0);
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let ang = F.t * (0.5 + F.a * 2.0) + fi * 2.1;
        let p = vec2<f32>(0.5 + 0.45 * cos(ang * 1.1), 0.5 + 0.4 * sin(ang * 0.9));
        let col = hsv(fract(F.t * 0.2 + fi / 3.0), 0.9, 1.0);
        add += col * exp(-length((uv - p) * vec2<f32>(aspect(), 1.0)) * 4.5);
    }
    return put(c, straight(c) * (1.0 - 0.35 * F.k) + add * F.k * 0.8);
}

fn e_neon_edges(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let s = straight(c);
    let e = clamp(edge_at(uv) * 2.5, 0.0, 1.0);
    let col = hsv(fract(lum(s) + uv.x * 0.5 + F.t * 0.2), 0.9, 1.0);
    return put(c, mix(s, s * 0.2 + col * e * 1.3, F.k));
}

fn e_confetti(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let cols = floor(10.0 + F.b * 30.0);
    let cx = floor(uv.x * cols);
    let fall = F.t * (0.2 + F.a * 0.8) * cols * 0.5 * (0.5 + h11(cx * 3.3));
    let gp = vec2<f32>(uv.x * cols, uv.y * cols / aspect() * 1.0 - fall);
    let id = floor(gp);
    let present = step(0.7, h21(id));
    let h = h21(id + vec2<f32>(5.0, 1.0));
    let l = rot2(fract(gp) - vec2<f32>(0.5), h * TAU + F.t * (2.0 + 4.0 * h));
    let inside = step(abs(l.x), 0.2) * step(abs(l.y), 0.1) * present;
    let col = hsv(h21(id + vec2<f32>(3.0, 3.0)), 0.8, 1.0);
    return put(c, mix(straight(c), col, inside * F.k));
}

// ---- Motion -------------------------------------------------------------------------------

fn e_zoom_punch(uv: vec2<f32>) -> vec4<f32> {
    let ph = fract(F.t * (0.4 + F.a * 2.6));
    return e_zoom(uv, 1.0 + F.k * 0.45 * exp(-ph * 9.0));
}

fn e_whip_pan(uv: vec2<f32>) -> vec4<f32> {
    let ph = fract(F.t * (0.3 + F.a * 1.2));
    let u = clamp(ph * 3.0, 0.0, 1.0);
    let pos = F.k * 0.7 * sin(u * PI);
    let spread = abs(cos(u * PI)) * F.k * 0.7 * PI * 0.12 * step(u, 0.999) * step(0.0001, u);
    var acc = vec4<f32>(0.0);
    for (var i = 0; i < 14; i++) {
        let f = f32(i) / 13.0 - 0.5;
        acc += texm(vec2<f32>(uv.x - pos + f * spread, uv.y));
    }
    return acc / 14.0;
}

fn e_camera_shake(uv: vec2<f32>) -> vec4<f32> {
    let f = 0.5 + F.a * 3.0;
    let off = vec2<f32>(vnoise(vec2<f32>(F.t * f, 1.0)) - 0.5, vnoise(vec2<f32>(F.t * f, 7.0)) - 0.5) * F.k * 0.06;
    let roll = (vnoise(vec2<f32>(F.t * f, 13.0)) - 0.5) * F.k * 0.07;
    let p = rot2((uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0), roll) / (1.0 + F.k * 0.1);
    return tex(p / vec2<f32>(aspect(), 1.0) + vec2<f32>(0.5) + off);
}

fn e_swing(uv: vec2<f32>) -> vec4<f32> {
    let ang = sin(F.t * (1.0 + F.a * 3.0)) * F.k * 0.22;
    let p = rot2((uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0), ang) / (1.0 + F.k * 0.3);
    return tex(p / vec2<f32>(aspect(), 1.0) + vec2<f32>(0.5));
}

fn e_spin(uv: vec2<f32>) -> vec4<f32> {
    let ang = F.t * (0.3 + F.a * 2.5) * F.k;
    let p = rot2((uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0), ang);
    return texm(p / vec2<f32>(aspect(), 1.0) + vec2<f32>(0.5));
}

fn e_bounce(uv: vec2<f32>) -> vec4<f32> {
    let ph = fract(F.t * (0.5 + F.a * 2.0));
    let y = abs(sin(ph * PI)) * F.k * 0.07;
    return tex(vec2<f32>((uv.x - 0.5) / (1.0 + F.k * 0.09) + 0.5, (uv.y - 0.5) / (1.0 + F.k * 0.09) + 0.5 + y));
}

fn e_echo(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    var rgb = straight(c);
    let dir = vec2<f32>(cos(F.t * 2.0), sin(F.t * 2.0)) * (0.01 + 0.05 * F.a);
    for (var i = 1; i <= 5; i++) {
        let fi = f32(i);
        let g = straight(tex(uv - dir * fi * F.k));
        rgb = mix(rgb, max(rgb, g), 0.55 * (1.0 - fi / 6.0));
    }
    return put(c, rgb);
}

fn e_heartbeat(uv: vec2<f32>) -> vec4<f32> {
    let ph = fract(F.t * (0.5 + F.a * 1.5));
    let a = (ph - 0.1) * 14.0;
    let b = (ph - 0.3) * 14.0;
    let pulse = exp(-a * a) + 0.7 * exp(-b * b);
    return e_zoom(uv, 1.0 + F.k * 0.12 * pulse);
}

// ---- Frames -------------------------------------------------------------------------------

fn e_letterbox(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let bar = F.k * 0.14;
    return select(vec4<f32>(0.0, 0.0, 0.0, 1.0), c, uv.y > bar && uv.y < 1.0 - bar);
}

fn e_border(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let w = F.k * 0.06;
    let wx = w / aspect();
    let inside = uv.x > wx && uv.x < 1.0 - wx && uv.y > w && uv.y < 1.0 - w;
    return select(vec4<f32>(vec3<f32>(F.a), 1.0), c, inside);
}

fn e_polaroid(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let w = F.k * 0.05;
    let wx = w / aspect();
    let bottom = F.k * 0.16;
    let inside = uv.x > wx && uv.x < 1.0 - wx && uv.y > w && uv.y < 1.0 - bottom;
    return select(vec4<f32>(0.96, 0.95, 0.92, 1.0), c, inside);
}

fn e_rounded(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let radius = F.k * 0.18;
    let p = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect(), 1.0);
    let half = vec2<f32>(aspect() * 0.5, 0.5);
    let q = abs(p) - (half - vec2<f32>(radius));
    let dist = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - radius;
    let alpha = 1.0 - smoothstep(-1.0 / F.size.y, 1.0 / F.size.y, dist);
    return c * alpha;
}

fn e_film_strip(uv: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let w = F.k * 0.1;
    let wx = w / aspect();
    let outside = uv.x < wx || uv.x > 1.0 - wx;
    if (!outside) {
        return c;
    }
    let local_x = select((uv.x) / wx, (1.0 - uv.x) / wx, uv.x > 0.5);
    let cell = fract(uv.y / 0.07);
    let hole = step(0.25, local_x) * step(local_x, 0.75) * step(0.2, cell) * step(cell, 0.7);
    return vec4<f32>(vec3<f32>(mix(0.04, 0.9, hole)), 1.0);
}

// ---- dispatch -----------------------------------------------------------------------------

fn run(uv: vec2<f32>, pos: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let kind = u32(F.kind + 0.5);
    switch kind {
        case 1u: { return e_blur(uv, c); }
        case 2u: { return e_zoom(uv, 1.0 + F.k * 0.6 * smoothstep(0.0, 1.0, F.prog)); }
        case 3u: { return e_zoom(uv, 1.0 + F.k * 0.6 * (1.0 - smoothstep(0.0, 1.0, F.prog))); }
        case 4u: { return e_shake(uv); }
        case 5u: { return e_flash(c); }
        case 6u: { return e_strobe(c); }
        case 7u: { return e_fade(c, 0.0, 1.0 - smoothstep(0.0, 1.0, F.prog)); }
        case 8u: { return e_fade(c, 0.0, smoothstep(0.0, 1.0, F.prog)); }
        case 9u: { return e_fade(c, 1.0, 1.0 - smoothstep(0.0, 1.0, F.prog)); }
        case 10u: { return e_fade(c, 1.0, smoothstep(0.0, 1.0, F.prog)); }
        case 11u: { return e_vignette_pulse(uv, c); }
        case 12u: { return e_mosaic(pos, c); }
        case 13u: { return e_mono(c); }
        case 14u: { return e_invert(c); }
        case 15u: { return e_sepia(c); }
        case 16u: { return e_comic(uv, c); }
        case 17u: { return e_sketch(uv, c); }
        case 20u: { return e_scanlines(pos, c); }
        case 21u: { return e_tracking(uv, c); }
        case 22u: { return e_colour_bleed(uv, c); }
        case 23u: { return e_film_grain(pos, c); }
        case 24u: { return e_dust(uv, c); }
        case 25u: { return e_old_film(uv, pos, c); }
        case 26u: { return e_crt(uv, pos); }
        case 27u: { return e_tape_jitter(uv); }
        case 28u: { return e_flicker(c); }
        case 30u: { return e_rgb_split(uv, c); }
        case 31u: { return e_block_glitch(uv, c); }
        case 32u: { return e_pixel_sort(uv, c); }
        case 33u: { return e_smear(uv, c); }
        case 34u: { return e_slice_glitch(uv, c); }
        case 35u: { return e_digital_noise(pos, c); }
        case 36u: { return e_static(pos, c); }
        case 37u: { return e_channel_swap(uv, c); }
        case 40u: { return leak(uv, c, vec3<f32>(1.0, 0.45, 0.1), vec3<f32>(1.0, 0.15, 0.3)); }
        case 41u: { return leak(uv, c, vec3<f32>(0.1, 0.5, 1.0), vec3<f32>(0.5, 0.2, 0.9)); }
        case 42u: { return e_leak_prism(uv, c); }
        case 43u: { return e_lens_flare(uv, c); }
        case 44u: { return e_glow(uv, c, F.k); }
        case 45u: { return e_glow(uv, c, F.k * (0.3 + 0.7 * (0.5 + 0.5 * sin(F.t * (1.0 + F.a * 5.0) * TAU * 0.5)))); }
        case 46u: { return e_sparkle(uv, c); }
        case 47u: { return e_dream(uv, c); }
        case 48u: { return e_sun_rays(uv, c); }
        case 49u: { return e_streak(uv, c); }
        case 50u: { return e_fisheye(uv); }
        case 51u: { return e_pinch(uv); }
        case 52u: { return e_magnify(uv, c); }
        case 53u: { return e_chroma_aberration(uv, c); }
        case 54u: { return e_tilt_shift(uv, c); }
        case 55u: { return e_mirror(uv, c, true); }
        case 56u: { return e_mirror(uv, c, false); }
        case 57u: { return e_kaleidoscope(uv, c); }
        case 58u: { return e_split(uv, c, 2.0, 1.0); }
        case 59u: { return e_split(uv, c, 3.0, 1.0); }
        case 60u: { return e_split(uv, c, 2.0, 2.0); }
        case 61u: { return e_split(uv, c, 3.0, 3.0); }
        case 62u: { return e_swirl(uv); }
        case 63u: { return e_ripple(uv); }
        case 64u: { return e_zoom_blur(uv); }
        case 65u: { return e_prism(uv, c); }
        case 70u: { return e_rainbow(uv, c); }
        case 71u: { return e_colour_cycle(c); }
        case 72u: { return e_beat_flash(c); }
        case 73u: { return e_disco(uv, c); }
        case 74u: { return e_neon_edges(uv, c); }
        case 75u: { return e_confetti(uv, c); }
        case 80u: { return e_zoom_punch(uv); }
        case 81u: { return e_whip_pan(uv); }
        case 82u: { return e_camera_shake(uv); }
        case 83u: { return e_swing(uv); }
        case 84u: { return e_spin(uv); }
        case 85u: { return e_bounce(uv); }
        case 86u: { return e_echo(uv, c); }
        case 87u: { return e_heartbeat(uv); }
        case 90u: { return e_letterbox(uv, c); }
        case 91u: { return e_border(uv, c); }
        case 92u: { return e_polaroid(uv, c); }
        case 93u: { return e_rounded(uv, c); }
        case 94u: { return e_film_strip(uv, c); }
        default: { return c; }
    }
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let p = floor(frag.xy);
    let c = textureLoad(src, vec2<i32>(p), 0);
    if (F.k <= 0.0001) {
        return c;
    }
    let pos = p + vec2<f32>(0.5);
    var o = clamp(run(pos / F.size, pos, c), vec4<f32>(0.0), vec4<f32>(1.0));
    // Premultiplied colour never exceeds its alpha.
    o = vec4<f32>(min(o.rgb, vec3<f32>(o.a)), o.a);
    if (F.opaque > 0.5) {
        o = vec4<f32>(o.rgb, 1.0);
    }
    return o;
}
