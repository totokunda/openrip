// CapCut's image pipeline, as measured in docs/parity/calibration.md (session 2).
// Every pass samples with explicit texel loads (no hardware filtering) so the maths is
// exactly the reference model's (bench/calibration/capcut_model.py).
// Textures hold premultiplied RGBA; texels outside a texture are transparent.

struct Params {
    src_size: vec2<f32>,
    dst_size: vec2<f32>,
    // Placement: texture coordinates of a canvas pixel centre (x, y):
    // u = inv0.x * x + inv0.y * y + inv0.z, v = inv1.x * x + inv1.y * y + inv1.z
    inv0: vec4<f32>,
    inv1: vec4<f32>,
    // x: opacity, y: sharpen strength
    misc: vec4<f32>,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    // One triangle covering the whole target.
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

// Downscale, stage 1a: exact area average of the source footprint of each output texel.
@fragment
fn fs_area(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let k = P.dst_size / P.src_size;
    let cell = floor(pos.xy);
    let lo = cell / k;
    let hi = (cell + 1.0) / k;
    var acc = vec4<f32>(0.0);
    var wsum = 0.0;
    for (var y = i32(floor(lo.y)); f32(y) < hi.y; y++) {
        let wy = min(f32(y + 1), hi.y) - max(f32(y), lo.y);
        for (var x = i32(floor(lo.x)); f32(x) < hi.x; x++) {
            let wx = min(f32(x + 1), hi.x) - max(f32(x), lo.x);
            acc += texel(vec2<i32>(x, y)) * (wx * wy);
            wsum += wx * wy;
        }
    }
    return acc / wsum;
}

// Downscale, stage 1b: 3x3 Laplacian sharpen (CapCut: strength 0.15), clamped.
@fragment
fn fs_sharpen(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let a = P.misc.y;
    let around = texel(p + vec2<i32>(0, -1)) + texel(p + vec2<i32>(0, 1)) + texel(p + vec2<i32>(-1, 0)) + texel(p + vec2<i32>(1, 0));
    return clamp((1.0 + 4.0 * a) * texel(p) - a * around, vec4<f32>(0.0), vec4<f32>(1.0));
}

// Upscale, stage 1: bilinear.
@fragment
fn fs_bilinear(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let u = pos.xy * P.src_size / P.dst_size;
    let b = floor(u - 0.5);
    let f = u - 0.5 - b;
    let p = vec2<i32>(b);
    let top = mix(texel(p), texel(p + vec2<i32>(1, 0)), f.x);
    let bottom = mix(texel(p + vec2<i32>(0, 1)), texel(p + vec2<i32>(1, 1)), f.x);
    return mix(top, bottom, f.y);
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

// Stage 2: place the stage-1 texture (residual scale, rotation, position) with Catmull-Rom.
@fragment
fn fs_place(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
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
    return clamp(acc / wsum, vec4<f32>(0.0), vec4<f32>(1.0)) * P.misc.x;
}

// Video import: NV12 / P010 planes (straight from the decoder's IOSurface, no copy) to RGBA
// at the luma resolution. 4:2:0 chroma is sited left horizontally and centred vertically
// (H.264/HEVC default) and interpolated bilinearly, clamped at the edges.
//   inv0: (y offset, y range, c offset, c range) in code values
//   inv1: (R from Cr, G from Cb, G from Cr, B from Cb)
//   misc.z: code values per unit sample (255 for 8-bit, 65535 / 64 for P010/P210)
//   misc.w: vertical chroma subsampling (2 for 4:2:0, 1 for 4:2:2)
@group(0) @binding(2) var chroma: texture_2d<f32>;

fn chroma_at(p: vec2<i32>) -> vec2<f32> {
    let s = vec2<i32>(textureDimensions(chroma)) - 1;
    return textureLoad(chroma, clamp(p, vec2<i32>(0), s), 0).rg;
}

@fragment
fn fs_yuv(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let k = P.misc.z;
    let y = (textureLoad(src, vec2<i32>(floor(pos.xy)), 0).r * k - P.inv0.x) / P.inv0.y;
    // Chroma sample i sits at luma x = 2i (left); vertically between luma rows 2j and 2j + 1
    // for 4:2:0, on row j for 4:2:2.
    let v = P.misc.w;
    let c = vec2<f32>(floor(pos.x) / 2.0, (pos.y - v / 2.0) / v);
    let b = floor(c);
    let f = c - b;
    let p = vec2<i32>(b);
    let top = mix(chroma_at(p), chroma_at(p + vec2<i32>(1, 0)), f.x);
    let bottom = mix(chroma_at(p + vec2<i32>(0, 1)), chroma_at(p + vec2<i32>(1, 1)), f.x);
    let cbcr = (mix(top, bottom, f.y) * k - P.inv0.z) / P.inv0.w;
    let rgb = vec3<f32>(y + P.inv1.x * cbcr.y, y + P.inv1.y * cbcr.x + P.inv1.z * cbcr.y, y + P.inv1.w * cbcr.x);
    return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

// Export: RGBA canvas -> NV12 planes (BT.709, limited range), written straight into the
// encoder's IOSurface. Luma per pixel; chroma averaged over each 2x2 block.
//   inv1: (Kr, Kg, Kb, unused)
@fragment
fn fs_luma(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(src, vec2<i32>(floor(pos.xy)), 0).rgb;
    let y = dot(c, P.inv1.xyz);
    return vec4<f32>((16.0 + 219.0 * y) / 255.0, 0.0, 0.0, 1.0);
}

@fragment
fn fs_chroma(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy)) * 2;
    let c = (texel(p).rgb + texel(p + vec2<i32>(1, 0)).rgb + texel(p + vec2<i32>(0, 1)).rgb + texel(p + vec2<i32>(1, 1)).rgb) * 0.25;
    let k = P.inv1.xyz;
    let y = dot(c, k);
    let cb = (c.b - y) / (2.0 * (1.0 - k.z));
    let cr = (c.r - y) / (2.0 * (1.0 - k.x));
    return vec4<f32>((128.0 + 224.0 * cb) / 255.0, (128.0 + 224.0 * cr) / 255.0, 0.0, 1.0);
}
