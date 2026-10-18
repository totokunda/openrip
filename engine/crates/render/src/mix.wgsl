// A transition putting two clips together: each drawn on its own canvas-sized group, then
// placed (moved, scaled, turned), faded and, for the incoming one, masked, the incoming
// clip over the outgoing one. Groups hold premultiplied colour; placement samples them
// bilinearly at texel centres (exact where a group isn't moved), clear outside, or mirrored
// for CapCut's Pull in, which also blurs each clip towards the canvas centre.

struct MixParams {
    // Canvas pixel -> outgoing group pixel: u = a0.x x + a0.y y + a0.z; a0.w its opacity.
    a0: vec4<f32>,
    // v = a1.x x + a1.y y + a1.z; a1.w its zoom blur.
    a1: vec4<f32>,
    // The same for the incoming clip.
    b0: vec4<f32>,
    b1: vec4<f32>,
    // x, y: the outgoing / incoming clip drawn (1) or not; z, w: mirrored outside (1).
    flags: vec4<f32>,
    // Where the incoming clip shows. x: 0 everywhere, 1 past an edge, 2 inside a circle.
    // Edge: y, z the direction it shows towards (canvas fractions), w how far along it
    // from the centre. Circle: w its radius in canvas heights.
    mask: vec4<f32>,
    // x: the mask's feather (its units); y, z: the canvas size in pixels.
    misc: vec4<f32>,
}

@group(0) @binding(0) var outgoing: texture_2d<f32>;
@group(0) @binding(1) var<uniform> M: MixParams;
@group(0) @binding(2) var incoming: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

// A group's texel; clear outside.
fn texel(which: i32, p: vec2<i32>) -> vec4<f32> {
    if (which == 0) {
        let d = vec2<i32>(textureDimensions(outgoing));
        if (p.x < 0 || p.y < 0 || p.x >= d.x || p.y >= d.y) {
            return vec4<f32>(0.0);
        }
        return textureLoad(outgoing, p, 0);
    }
    let d = vec2<i32>(textureDimensions(incoming));
    if (p.x < 0 || p.y < 0 || p.x >= d.x || p.y >= d.y) {
        return vec4<f32>(0.0);
    }
    return textureLoad(incoming, p, 0);
}

// Bilinear at a point in texels (texel centres at +0.5).
fn bilinear(which: i32, x: vec2<f32>) -> vec4<f32> {
    let p = x - vec2<f32>(0.5);
    let i = floor(p);
    let f = p - i;
    let a = vec2<i32>(i);
    let top = mix(texel(which, a), texel(which, a + vec2<i32>(1, 0)), f.x);
    let bottom = mix(texel(which, a + vec2<i32>(0, 1)), texel(which, a + vec2<i32>(1, 1)), f.x);
    return mix(top, bottom, f.y);
}

// A point in 0..1 mirrored at both edges, as Pull in's shader does (abs, then 2 - x), in
// texels, clamped to the edge texels' centres (its texture clamps to the edge).
fn mirrored(uv: vec2<f32>) -> vec2<f32> {
    let size = M.misc.yz;
    var m = abs(uv);
    m = select(m, vec2<f32>(2.0) - m, m > vec2<f32>(1.0));
    return clamp(m * size, vec2<f32>(0.5), size - vec2<f32>(0.5));
}

// One clip at canvas pixel `pos`: placed, mirrored or clear outside, zoom-blurred.
fn shot(which: i32, pos: vec2<f32>, r0: vec4<f32>, r1: vec4<f32>, mirror: bool) -> vec4<f32> {
    let size = M.misc.yz;
    let at = vec2<f32>(r0.x * pos.x + r0.y * pos.y + r0.z, r1.x * pos.x + r1.y * pos.y + r1.z);
    let blur = r1.w;
    if (blur <= 0.0) {
        if (mirror) {
            return bilinear(which, mirrored(at / size));
        }
        return bilinear(which, at);
    }
    // Pull in's blur: 21 taps from i = -10 to 10 at uv + 10/720 · i · (uv - 0.5) · 2 · blur.
    let uv = at / size;
    var sum = vec4<f32>(0.0);
    for (var i = -10; i <= 10; i++) {
        let q = uv + (10.0 / 720.0) * f32(i) * (uv - vec2<f32>(0.5)) * 2.0 * blur;
        sum += bilinear(which, select(q * size, mirrored(q), mirror));
    }
    return sum / 21.0;
}

// How much of the incoming clip shows at canvas pixel `pos`.
fn coverage(pos: vec2<f32>) -> f32 {
    let size = M.misc.yz;
    let feather = max(M.misc.x, 1e-4);
    let kind = i32(M.mask.x + 0.5);
    if (kind == 1) {
        let d = dot(pos / size - vec2<f32>(0.5), M.mask.yz) - M.mask.w;
        return clamp(d / feather + 0.5, 0.0, 1.0);
    }
    if (kind == 2) {
        let d = length((pos - size * 0.5) / size.y) - M.mask.w;
        return clamp(0.5 - d / feather, 0.0, 1.0);
    }
    return 1.0;
}

@fragment
fn fs_mix(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    var a = vec4<f32>(0.0);
    if (M.flags.x > 0.5) {
        a = shot(0, pos.xy, M.a0, M.a1, M.flags.z > 0.5) * M.a0.w;
    }
    var b = vec4<f32>(0.0);
    if (M.flags.y > 0.5) {
        b = shot(1, pos.xy, M.b0, M.b1, M.flags.w > 0.5) * (M.b0.w * coverage(pos.xy));
    }
    return clamp(b + a * (1.0 - b.a), vec4<f32>(0.0), vec4<f32>(1.0));
}
