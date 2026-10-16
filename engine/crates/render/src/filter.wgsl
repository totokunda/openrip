// A 3D lookup table over everything drawn so far (CapCut's filters, on filter tracks):
// sampled like a GPU 3D texture (texel centres at (i + 0.5) / n, clamped at the edges),
// mixed in by `strength`. The table is laid out in 2D: red across, blue by blocks of n
// columns, green down.

struct FilterParams {
    n: f32,
    strength: f32,
    unused: vec2<f32>,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> F: FilterParams;
@group(0) @binding(2) var lut: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

fn entry(r: f32, g: f32, b: f32) -> vec3<f32> {
    return textureLoad(lut, vec2<i32>(i32(r + b * F.n), i32(g)), 0).rgb;
}

@fragment
fn fs_lut3d(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = textureLoad(src, vec2<i32>(floor(pos.xy)), 0);
    if (px.a <= 0.0) {
        return px;
    }
    let c = clamp(px.rgb / px.a, vec3<f32>(0.0), vec3<f32>(1.0));
    let top = F.n - 1.0;
    let p = clamp(c * F.n - 0.5, vec3<f32>(0.0), vec3<f32>(top));
    let i = floor(p);
    let j = min(i + 1.0, vec3<f32>(top));
    let f = p - i;
    let c00 = mix(entry(i.x, i.y, i.z), entry(j.x, i.y, i.z), f.x);
    let c10 = mix(entry(i.x, j.y, i.z), entry(j.x, j.y, i.z), f.x);
    let c01 = mix(entry(i.x, i.y, j.z), entry(j.x, i.y, j.z), f.x);
    let c11 = mix(entry(i.x, j.y, j.z), entry(j.x, j.y, j.z), f.x);
    let looked = mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
    let out = clamp(mix(c, looked, F.strength), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(out * px.a, px.a);
}
