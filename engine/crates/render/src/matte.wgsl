// A mask over a clip's own pixels, before placement: CapCut's background removal and video
// masks, and the app's masks. The mask covers the whole clip and is sampled bilinearly,
// stretched to it. Inside it the clip shows as `inside`, outside as `outside`: each either
// a premultiplied colour or, when its alpha is negative, the clip's own pixels. A cut-out
// is the clip inside and clear outside: the clip times the mask.

struct MatteParams {
    inside: vec4<f32>,
    outside: vec4<f32>,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> M: MatteParams;
@group(0) @binding(2) var mask: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

fn mask_texel(q: vec2<i32>) -> f32 {
    let d = vec2<i32>(textureDimensions(mask));
    return textureLoad(mask, clamp(q, vec2<i32>(0), d - vec2<i32>(1)), 0).r;
}

@fragment
fn fs_matte(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = textureLoad(src, vec2<i32>(floor(pos.xy)), 0);
    let scale = vec2<f32>(textureDimensions(mask)) / vec2<f32>(textureDimensions(src));
    let p = pos.xy * scale - vec2<f32>(0.5);
    let i = floor(p);
    let f = p - i;
    let a = vec2<i32>(i);
    let top = mix(mask_texel(a), mask_texel(a + vec2<i32>(1, 0)), f.x);
    let bottom = mix(mask_texel(a + vec2<i32>(0, 1)), mask_texel(a + vec2<i32>(1, 1)), f.x);
    let inside = select(M.inside, px, M.inside.a < 0.0);
    let outside = select(M.outside, px, M.outside.a < 0.0);
    return mix(outside, inside, mix(top, bottom, f.y));
}
