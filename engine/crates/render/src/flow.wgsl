// Dense optical flow and motion-compensated interpolation (Smooth slow-mo, Optical flow).
// Pass for pass the GPU version of openrip-motion's flow.rs, which documents the method and
// is what the tests compare against. Every read is an explicit texel load (no samplers), so
// float textures work everywhere and the maths matches the CPU reference.
//
// Textures: level pictures hold (intensity 0-1, d/dx, d/dy, 0) at half precision; flows hold
// (dx, dy, 0, 0) in pixels of their level at full precision; the frames are premultiplied
// RGBA. Bindings 1 and 2 (pictures) can be read with the hardware's bilinear filter (the
// inner loops' reads of the second picture); 0 and 3 (flows) are read texel by texel.

struct Params {
    a: vec4<f32>,
    b: vec4<f32>,
};

@group(0) @binding(0) var t0: texture_2d<f32>;
@group(0) @binding(1) var t1: texture_2d<f32>;
@group(0) @binding(2) var t2: texture_2d<f32>;
@group(0) @binding(3) var t3: texture_2d<f32>;
@group(0) @binding(4) var<uniform> P: Params;
@group(0) @binding(5) var smp: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

// Reads clamp to the texture's edge.
fn ld0(p: vec2<i32>) -> vec4<f32> {
    let s = vec2<i32>(textureDimensions(t0)) - 1;
    return textureLoad(t0, clamp(p, vec2<i32>(0), s), 0);
}
fn ld1(p: vec2<i32>) -> vec4<f32> {
    let s = vec2<i32>(textureDimensions(t1)) - 1;
    return textureLoad(t1, clamp(p, vec2<i32>(0), s), 0);
}
fn ld2(p: vec2<i32>) -> vec4<f32> {
    let s = vec2<i32>(textureDimensions(t2)) - 1;
    return textureLoad(t2, clamp(p, vec2<i32>(0), s), 0);
}
fn ld3(p: vec2<i32>) -> vec4<f32> {
    let s = vec2<i32>(textureDimensions(t3)) - 1;
    return textureLoad(t3, clamp(p, vec2<i32>(0), s), 0);
}

// Bilinear reads at pixel coordinates (pixel centres at integers), clamped.
fn bl0(q: vec2<f32>) -> vec4<f32> {
    let s = vec2<f32>(textureDimensions(t0)) - 1.0;
    let p = clamp(q, vec2<f32>(0.0), s);
    let i = vec2<i32>(floor(p));
    let f = p - floor(p);
    return mix(mix(ld0(i), ld0(i + vec2<i32>(1, 0)), f.x), mix(ld0(i + vec2<i32>(0, 1)), ld0(i + vec2<i32>(1, 1)), f.x), f.y);
}
fn bl1(q: vec2<f32>) -> vec4<f32> {
    let s = vec2<f32>(textureDimensions(t1)) - 1.0;
    let p = clamp(q, vec2<f32>(0.0), s);
    let i = vec2<i32>(floor(p));
    let f = p - floor(p);
    return mix(mix(ld1(i), ld1(i + vec2<i32>(1, 0)), f.x), mix(ld1(i + vec2<i32>(0, 1)), ld1(i + vec2<i32>(1, 1)), f.x), f.y);
}
fn bl2(q: vec2<f32>) -> vec4<f32> {
    let s = vec2<f32>(textureDimensions(t2)) - 1.0;
    let p = clamp(q, vec2<f32>(0.0), s);
    let i = vec2<i32>(floor(p));
    let f = p - floor(p);
    return mix(mix(ld2(i), ld2(i + vec2<i32>(1, 0)), f.x), mix(ld2(i + vec2<i32>(0, 1)), ld2(i + vec2<i32>(1, 1)), f.x), f.y);
}
fn bl3(q: vec2<f32>) -> vec4<f32> {
    let s = vec2<f32>(textureDimensions(t3)) - 1.0;
    let p = clamp(q, vec2<f32>(0.0), s);
    let i = vec2<i32>(floor(p));
    let f = p - floor(p);
    return mix(mix(ld3(i), ld3(i + vec2<i32>(1, 0)), f.x), mix(ld3(i + vec2<i32>(0, 1)), ld3(i + vec2<i32>(1, 1)), f.x), f.y);
}

// Bilinear reads by the hardware's filter, at pixel coordinates (edges clamped).
fn sb1(q: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(t1, smp, (q + 0.5) / vec2<f32>(textureDimensions(t1)), 0.0);
}
fn sb2(q: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(t2, smp, (q + 0.5) / vec2<f32>(textureDimensions(t2)), 0.0);
}

fn luma(c: vec4<f32>) -> f32 {
    return dot(c.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// t0 as it is (clamped: a 1×1 texture fills the target).
@fragment
fn fs_copy(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return ld0(vec2<i32>(floor(pos.xy)));
}

// A frame (t0, premultiplied RGBA) to the working resolution's intensity: the mean luma of
// each a.x × a.x block.
@fragment
fn fs_gray(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let k = i32(P.a.x);
    let o = vec2<i32>(floor(pos.xy)) * k;
    var sum = 0.0;
    for (var y = 0; y < k; y++) {
        for (var x = 0; x < k; x++) {
            sum += luma(ld0(o + vec2<i32>(x, y)));
        }
    }
    return vec4<f32>(sum / f32(k * k), 0.0, 0.0, 0.0);
}

// The next pyramid level from t0: the 5-tap binomial kernel at every other pixel.
@fragment
fn fs_down(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let c = vec2<i32>(floor(pos.xy)) * 2;
    var k = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);
    var sum = 0.0;
    for (var j = 0; j < 5; j++) {
        for (var i = 0; i < 5; i++) {
            sum += k[i] * k[j] * ld0(c + vec2<i32>(i - 2, j - 2)).r;
        }
    }
    return vec4<f32>(sum, 0.0, 0.0, 0.0);
}

// Scharr derivatives of t0's intensity, normalised to a unit ramp: (I, dI/dx, dI/dy, 0).
@fragment
fn fs_grad(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let a = ld0(p + vec2<i32>(-1, -1)).r;
    let b = ld0(p + vec2<i32>(0, -1)).r;
    let c = ld0(p + vec2<i32>(1, -1)).r;
    let d = ld0(p + vec2<i32>(-1, 0)).r;
    let f = ld0(p + vec2<i32>(1, 0)).r;
    let g = ld0(p + vec2<i32>(-1, 1)).r;
    let h = ld0(p + vec2<i32>(0, 1)).r;
    let i = ld0(p + vec2<i32>(1, 1)).r;
    let dx = (3.0 * (c - a) + 10.0 * (f - d) + 3.0 * (i - g)) / 32.0;
    let dy = (3.0 * (g - a) + 10.0 * (h - b) + 3.0 * (i - c)) / 32.0;
    return vec4<f32>(ld0(p).r, dx, dy, 0.0);
}

// The coarser level's flow (t0) at this level: pixel (x, y) here sits at (x/2, y/2) there.
@fragment
fn fs_upsample(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let f = bl0(floor(pos.xy) * 0.5).xy * 2.0;
    return vec4<f32>(f, 0.0, 0.0);
}

// The coarsest level's start: per pixel, the whole-pixel motion up to a.x pixels under which
// its 5×5 patch of A (t1) best matches B (t2), each pixel of motion costing a.y.
@fragment
fn fs_search(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let r = i32(P.a.x);
    var best = 1e30;
    var pick = vec2<i32>(0);
    for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
            var cost = 0.0;
            for (var qy = -2; qy <= 2; qy++) {
                for (var qx = -2; qx <= 2; qx++) {
                    let q = p + vec2<i32>(qx, qy);
                    cost += abs(ld2(q + vec2<i32>(dx, dy)).r - ld1(q).r);
                }
            }
            cost = cost / 25.0 + P.a.y * sqrt(f32(dx * dx + dy * dy));
            if (cost < best) {
                best = cost;
                pick = vec2<i32>(dx, dy);
            }
        }
    }
    return vec4<f32>(vec2<f32>(pick), 0.0, 0.0);
}

// The pixel and its eight neighbours, in the CPU reference's order.
fn nb(i: i32) -> vec2<i32> {
    var n = array<vec2<i32>, 9>(
        vec2<i32>(0, 0), vec2<i32>(-1, -1), vec2<i32>(0, -1), vec2<i32>(1, -1), vec2<i32>(-1, 0),
        vec2<i32>(1, 0), vec2<i32>(-1, 1), vec2<i32>(0, 1), vec2<i32>(1, 1),
    );
    return n[i];
}

// Each pixel's vector (flow t0) replaced by the one among its own and its neighbours' a.x
// pixels away under which a patch (taps 2 px apart) of picture A (t1) best matches B (t2).
@fragment
fn fs_select(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let r = i32(P.a.x);
    var best = 1e30;
    var pick = vec2<f32>(0.0);
    for (var c = 0; c < 9; c++) {
        let cand = ld0(p + nb(c) * r).xy;
        var cost = 0.0;
        for (var q = 0; q < 9; q++) {
            let at = p + nb(q) * 2;
            cost += abs(sb2(vec2<f32>(at) + cand).r - ld1(at).r);
        }
        if (cost < best) {
            best = cost;
            pick = cand;
        }
    }
    return vec4<f32>(pick, 0.0, 0.0);
}

// One robust Lucas–Kanade step: flow t0, level A (t1: I, dx, dy), level B (t2: I).
// a = (sigma, lambda, relative, robust), b.x = the most a step moves (pixels).
@fragment
fn fs_lk(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let size = vec2<i32>(textureDimensions(t1)) - 1;
    let inv = 1.0 / vec2<f32>(textureDimensions(t2));
    let uv = ld0(p).xy;
    let sigma = P.a.x;
    var gw: array<f32, 7>;
    for (var i = 0; i < 7; i++) {
        gw[i] = exp(-f32((i - 3) * (i - 3)) / (2.0 * sigma * sigma));
    }
    var sxx = 0.0;
    var sxy = 0.0;
    var syy = 0.0;
    var sxt = 0.0;
    var syt = 0.0;
    var norm = 0.0;
    for (var dy = -3; dy <= 3; dy++) {
        for (var dx = -3; dx <= 3; dx++) {
            let g = gw[dy + 3] * gw[dx + 3];
            norm += g;
            let q = clamp(p + vec2<i32>(dx, dy), vec2<i32>(0), size);
            let a = textureLoad(t1, q, 0);
            let it = textureSampleLevel(t2, smp, (vec2<f32>(q) + uv + 0.5) * inv, 0.0).r - a.r;
            var w = g;
            if (P.a.w > 0.0) {
                let e = it / P.a.w;
                w = g / (1.0 + e * e);
            }
            sxx += w * a.g * a.g;
            sxy += w * a.g * a.b;
            syy += w * a.b * a.b;
            sxt += w * a.g * it;
            syt += w * a.b * it;
        }
    }
    let gxx = sxx / norm;
    let gxy = sxy / norm;
    let gyy = syy / norm;
    let bx = sxt / norm;
    let by = syt / norm;
    let damp = P.a.y + P.a.z * (gxx + gyy);
    let a11 = gxx + damp;
    let a22 = gyy + damp;
    let det = a11 * a22 - gxy * gxy;
    if (det <= 1e-20) {
        return vec4<f32>(uv, 0.0, 0.0);
    }
    var du = vec2<f32>(-(a22 * bx - gxy * by) / det, -(a11 * by - gxy * bx) / det);
    let len = length(du);
    if (len > P.b.x) {
        du = du * (P.b.x / len);
    }
    return vec4<f32>(uv + du, 0.0, 0.0);
}

fn median9(v: array<f32, 9>) -> f32 {
    var a = v;
    for (var i = 1; i < 9; i++) {
        let x = a[i];
        var j = i - 1;
        while (j >= 0 && a[j] > x) {
            a[j + 1] = a[j];
            j--;
        }
        a[j + 1] = x;
    }
    return a[4];
}

// The 3×3 median of each component of flow t0.
@fragment
fn fs_median(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    var us: array<f32, 9>;
    var vs: array<f32, 9>;
    var n = 0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let f = ld0(p + vec2<i32>(dx, dy)).xy;
            us[n] = f.x;
            vs[n] = f.y;
            n++;
        }
    }
    return vec4<f32>(median9(us), median9(vs), 0.0, 0.0);
}

// Where a pixel's content at time t comes from, at the working resolution: flow A→B (t0) and
// B→A (t3), level-0 pictures A (t1) and B (t2). a.x = t, a.y and a.z the patch mismatch up to
// which the motion is trusted fully and from which not at all. Out: (the motion m through
// the pixel from A to B, how far to mix toward B, how far to trust it over a cross-fade):
// read A at x − t·m and B at x + (1 − t)·m.
@fragment
fn fs_tween_plan(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let x = floor(pos.xy);
    let t = P.a.x;
    var m = bl0(x).xy;
    for (var i = 0; i < 4; i++) {
        m = bl0(x - t * m).xy;
    }
    var n = bl3(x).xy;
    for (var i = 0; i < 4; i++) {
        n = bl3(x - (1.0 - t) * n).xy;
    }
    let m2 = -n;
    let cost_m = abs(sb1(x - t * m).r - sb2(x + (1.0 - t) * m).r);
    let cost_n = abs(sb1(x - t * m2).r - sb2(x + (1.0 - t) * m2).r);
    var best = m;
    if (cost_n < cost_m) {
        best = m2;
    }
    let p = x - t * best;
    let q = x + (1.0 - t) * best;
    // Forward–backward disagreement at each end.
    let d_q = bl3(q).xy;
    let e_q = length(d_q + bl0(q + d_q).xy);
    let d_p = bl0(p).xy;
    let e_p = length(d_p + bl3(p + d_p).xy);
    let q_seen_in_a = 1.0 / (1.0 + e_q * e_q);
    let p_seen_in_b = 1.0 / (1.0 + e_p * e_p);
    var wa = (1.0 - t) * q_seen_in_a;
    var wb = t * p_seen_in_b;
    if (wa + wb < 1e-3) {
        wa = 1.0 - t;
        wb = t;
    }
    var mismatch = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let d = vec2<f32>(f32(dx), f32(dy));
            mismatch += abs(sb1(p + d).r - sb2(q + d).r);
        }
    }
    let off = clamp((mismatch / 9.0 - P.a.y) / (P.a.z - P.a.y), 0.0, 1.0);
    let fail = max(off * min(q_seen_in_a, p_seen_in_b), 1.0 - max(q_seen_in_a, p_seen_in_b));
    return vec4<f32>(best, wb / (wa + wb), 1.0 - fail);
}

// The picture at time t at full resolution: frames A (t1) and B (t2), the plan (t0) at the
// working resolution a.y times smaller. a.x = t, a.z = 1 for a straight cross-fade instead.
@fragment
fn fs_tween(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let x = floor(pos.xy);
    let t = P.a.x;
    if (P.a.z > 0.5) {
        let p = vec2<i32>(x);
        return mix(ld1(p), ld2(p), t);
    }
    let k = P.a.y;
    // Working pixel centres sit at the middle of their k × k blocks.
    let w = (x - 0.5 * (k - 1.0)) / k;
    let plan = bl0(w);
    let m = plan.xy * k;
    let flowed = mix(sb1(x - t * m), sb2(x + (1.0 - t) * m), plan.z);
    let p = vec2<i32>(x);
    let blended = mix(ld1(p), ld2(p), t);
    return mix(blended, flowed, plan.w);
}
