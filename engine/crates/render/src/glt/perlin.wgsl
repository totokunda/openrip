// perlin — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/perlin.glsl
// Author: Rich Harris
// License: MIT
// Description: The incoming image appears through blobs of Perlin noise
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    scale: f32,
    smoothness: f32,
    seed: f32,
}

@group(0) @binding(2) 
var _from: texture_2d<f32>;
@group(0) @binding(1) 
var _sampler: sampler;
@group(0) @binding(3) 
var _to: texture_2d<f32>;
@group(0) @binding(0) 
var<uniform> uniforms: Uniforms;
var<private> _fragColor: vec4<f32>;
var<private> _uv_1: vec2<f32>;

fn random(co: ptr<function, vec2<f32>>) -> f32 {
    var a: f32;
    var b: f32;
    var c: f32;
    var dt: f32;
    var sn: f32;

    let _e29 = uniforms.seed;
    a = _e29;
    b = 78.233f;
    c = 43758.547f;
    let _e30 = (*co);
    let _e31 = a;
    let _e32 = b;
    dt = dot(_e30, vec2<f32>(_e31, _e32));
    let _e35 = dt;
    sn = (_e35 - (floor((_e35 / 3.14f)) * 3.14f));
    let _e40 = sn;
    let _e42 = c;
    return fract((sin(_e40) * _e42));
}

fn noise(st: ptr<function, vec2<f32>>) -> f32 {
    var i: vec2<f32>;
    var f: vec2<f32>;
    var a_1: f32;
    var param: vec2<f32>;
    var b_1: f32;
    var param_1: vec2<f32>;
    var c_1: f32;
    var param_2: vec2<f32>;
    var d: f32;
    var param_3: vec2<f32>;
    var u: vec2<f32>;

    let _e34 = (*st);
    i = floor(_e34);
    let _e36 = (*st);
    f = fract(_e36);
    let _e38 = i;
    param = _e38;
    let _e39 = random((&param));
    a_1 = _e39;
    let _e40 = i;
    param_1 = (_e40 + vec2<f32>(1f, 0f));
    let _e42 = random((&param_1));
    b_1 = _e42;
    let _e43 = i;
    param_2 = (_e43 + vec2<f32>(0f, 1f));
    let _e45 = random((&param_2));
    c_1 = _e45;
    let _e46 = i;
    param_3 = (_e46 + vec2<f32>(1f, 1f));
    let _e48 = random((&param_3));
    d = _e48;
    let _e49 = f;
    let _e50 = f;
    let _e52 = f;
    u = ((_e49 * _e50) * (vec2(3f) - (_e52 * 2f)));
    let _e57 = a_1;
    let _e58 = b_1;
    let _e60 = u[0u];
    let _e62 = c_1;
    let _e63 = a_1;
    let _e66 = u[1u];
    let _e69 = u[0u];
    let _e73 = d;
    let _e74 = b_1;
    let _e77 = u[0u];
    let _e80 = u[1u];
    return ((mix(_e57, _e58, _e60) + (((_e62 - _e63) * _e66) * (1f - _e69))) + (((_e73 - _e74) * _e77) * _e80));
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e24 = (*uv)[0u];
    let _e26 = (*uv)[1u];
    let _e29 = textureSampleLevel(_to, _sampler, vec2<f32>(_e24, (1f - _e26)), 0f);
    return _e29;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e24 = (*uv_1)[0u];
    let _e26 = (*uv_1)[1u];
    let _e29 = textureSampleLevel(_from, _sampler, vec2<f32>(_e24, (1f - _e26)), 0f);
    return _e29;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var from_: vec4<f32>;
    var param_4: vec2<f32>;
    var to: vec4<f32>;
    var param_5: vec2<f32>;
    var n: f32;
    var param_6: vec2<f32>;
    var p: f32;
    var lower: f32;
    var higher: f32;
    var q: f32;

    let _e33 = (*uv_2);
    param_4 = _e33;
    let _e34 = getFromColor((&param_4));
    from_ = _e34;
    let _e35 = (*uv_2);
    param_5 = _e35;
    let _e36 = getToColor((&param_5));
    to = _e36;
    let _e37 = (*uv_2);
    let _e39 = uniforms.scale;
    param_6 = (_e37 * _e39);
    let _e41 = noise((&param_6));
    n = _e41;
    let _e43 = uniforms.smoothness;
    let _e46 = uniforms.smoothness;
    let _e49 = uniforms.progress;
    p = mix(-(_e43), (1f + _e46), _e49);
    let _e51 = p;
    let _e53 = uniforms.smoothness;
    lower = (_e51 - _e53);
    let _e55 = p;
    let _e57 = uniforms.smoothness;
    higher = (_e55 + _e57);
    let _e59 = lower;
    let _e60 = higher;
    let _e61 = n;
    q = smoothstep(_e59, _e60, _e61);
    let _e63 = from_;
    let _e64 = to;
    let _e65 = q;
    return mix(_e63, _e64, vec4((1f - _e65)));
}

fn main_1() {
    var param_7: vec2<f32>;

    let _e23 = _uv_1;
    param_7 = _e23;
    let _e24 = transition((&param_7));
    _fragColor = _e24;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
