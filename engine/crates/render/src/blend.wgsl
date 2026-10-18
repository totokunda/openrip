// A layer placed with a blend mode (CapCut's Blend › Mode; see blend.rs for the maths): the
// layer is placed as fs_place places it (shaders.wgsl: Catmull-Rom from its stage texture,
// times its opacity), then put over the backdrop, a copy of the canvas below it, by the
// mode's function. The result is written as it is (no blending), so pixels the layer doesn't
// reach are discarded and keep the canvas.

struct Params {
    src_size: vec2<f32>,
    dst_size: vec2<f32>,
    inv0: vec4<f32>,
    inv1: vec4<f32>,
    // x: opacity, y: the mode (blend.rs `BlendMode::index`)
    misc: vec4<f32>,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var backdrop: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn texel(p: vec2<i32>) -> vec4<f32> {
    let s = vec2<i32>(textureDimensions(src));
    if (p.x < 0 || p.y < 0 || p.x >= s.x || p.y >= s.y) {
        return vec4<f32>(0.0);
    }
    return textureLoad(src, p, 0);
}

fn catrom(x: f32) -> f32 {
    let a = abs(x);
    if (a < 1.0) {
        return (1.5 * a - 2.5) * a * a + 1.0;
    }
    if (a < 2.0) {
        return ((-0.5 * a + 2.5) * a - 4.0) * a + 2.0;
    }
    return 0.0;
}

fn channel(mode: i32, b: f32, s: f32) -> f32 {
    switch mode {
        // Darken, Screen, Overlay, Multiply, Lighten
        case 1: { return min(b, s); }
        case 2: { return b + s - b * s; }
        case 3: { return select(1.0 - 2.0 * (1.0 - b) * (1.0 - s), 2.0 * b * s, b < 0.5); }
        case 4: { return b * s; }
        case 5: { return max(b, s); }
        // Color burn: black burns to black, except over white.
        case 6: {
            if (s <= 0.0) {
                return select(0.0, 1.0, b >= 1.0);
            }
            return 1.0 - min((1.0 - b) / s, 1.0);
        }
        // Color dodge: white dodges to white.
        case 7: {
            if (s >= 1.0) {
                return 1.0;
            }
            return min(b / (1.0 - s), 1.0);
        }
        // Linear burn, Soft light (CapCut's: √b above the middle), Hard light
        case 8: { return max(b + s - 1.0, 0.0); }
        case 9: {
            if (s <= 0.5) {
                return 2.0 * b * s + b * b * (1.0 - 2.0 * s);
            }
            return sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s);
        }
        case 10: { return select(1.0 - 2.0 * (1.0 - s) * (1.0 - b), 2.0 * s * b, s < 0.5); }
        default: { return s; }
    }
}

@fragment
fn fs_place_blend(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let u = P.inv0.x * pos.x + P.inv0.y * pos.y + P.inv0.z;
    let v = P.inv1.x * pos.x + P.inv1.y * pos.y + P.inv1.z;
    if (u < -2.0 || v < -2.0 || u > P.src_size.x + 2.0 || v > P.src_size.y + 2.0) {
        discard;
    }
    let bu = floor(u - 0.5);
    let bv = floor(v - 0.5);
    var acc = vec4<f32>(0.0);
    var wsum = 0.0;
    for (var j = -1; j <= 2; j++) {
        let wy = catrom(bv + f32(j) + 0.5 - v);
        for (var i = -1; i <= 2; i++) {
            let wx = catrom(bu + f32(i) + 0.5 - u);
            acc += texel(vec2<i32>(i32(bu) + i, i32(bv) + j)) * (wx * wy);
            wsum += wx * wy;
        }
    }
    let s = clamp(acc / wsum, vec4<f32>(0.0), vec4<f32>(1.0)) * P.misc.x;
    let b = textureLoad(backdrop, vec2<i32>(floor(pos.xy)), 0);
    if (s.a <= 0.0) {
        return b;
    }
    let mode = i32(P.misc.y + 0.5);
    let cs = clamp(s.rgb / s.a, vec3<f32>(0.0), vec3<f32>(1.0));
    let cb = select(vec3<f32>(0.0), clamp(b.rgb / b.a, vec3<f32>(0.0), vec3<f32>(1.0)), b.a > 0.0);
    let blended = vec3<f32>(channel(mode, cb.r, cs.r), channel(mode, cb.g, cs.g), channel(mode, cb.b, cs.b));
    let rgb = s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * blended;
    return clamp(vec4<f32>(rgb, s.a + b.a - s.a * b.a), vec4<f32>(0.0), vec4<f32>(1.0));
}
