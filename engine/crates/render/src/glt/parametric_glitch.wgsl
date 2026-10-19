// parametric_glitch — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/parametric_glitch.glsl
// Author: Yoni Maltsman @friendlyspinach
// License: MIT
// Description: A crossfade with glitchy horizontal bands and color shifts
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    ampx: f32,
    ampy: f32,
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

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv)[0u];
    let _e19 = (*uv)[1u];
    let _e22 = textureSampleLevel(_to, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv_1)[0u];
    let _e19 = (*uv_1)[1u];
    let _e22 = textureSampleLevel(_from, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var from_: vec4<f32>;
    var param: vec2<f32>;
    var to: vec4<f32>;
    var param_1: vec2<f32>;
    var r: f32;
    var g: f32;
    var b: f32;
    var sphere: f32;
    var spiralX: f32;
    var spiralY: f32;
    var st: vec2<f32>;
    var diff: vec2<f32>;
    var param_2: vec2<f32>;

    let _e29 = (*uv_2);
    param = _e29;
    let _e30 = getFromColor((&param));
    from_ = _e30;
    let _e31 = (*uv_2);
    param_1 = _e31;
    let _e32 = getToColor((&param_1));
    to = _e32;
    let _e34 = from_[0u];
    r = _e34;
    let _e36 = from_[1u];
    g = _e36;
    let _e38 = from_[2u];
    b = _e38;
    let _e39 = r;
    let _e40 = r;
    let _e42 = g;
    let _e43 = g;
    let _e46 = b;
    let _e47 = b;
    sphere = ((((_e39 * _e40) + (_e42 * _e43)) + (_e46 * _e47)) - 1f);
    let _e51 = sphere;
    let _e53 = (*uv_2)[0u];
    let _e55 = uniforms.progress;
    spiralX = cos((_e51 - (_e53 / (_e55 + 0.01f))));
    let _e60 = sphere;
    let _e62 = (*uv_2)[1u];
    let _e64 = uniforms.progress;
    spiralY = sin((_e60 - (_e62 / (_e64 + 0.01f))));
    let _e69 = (*uv_2);
    st = _e69;
    let _e71 = uniforms.ampx;
    let _e73 = st[0u];
    let _e75 = spiralX;
    st[0u] = fract(((_e71 * _e73) * _e75));
    let _e80 = uniforms.ampy;
    let _e82 = st[1u];
    let _e84 = spiralY;
    st[1u] = fract(((_e80 * _e82) * _e84));
    let _e88 = (*uv_2);
    let _e89 = st;
    diff = (_e88 - _e89);
    let _e91 = (*uv_2);
    let _e93 = uniforms.progress;
    let _e94 = diff;
    param_2 = (_e91 + (_e94 * _e93));
    let _e97 = getFromColor((&param_2));
    from_ = _e97;
    let _e98 = from_;
    let _e99 = to;
    let _e101 = uniforms.progress;
    return mix(_e98, _e99, vec4(_e101));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e16 = _uv_1;
    param_3 = _e16;
    let _e17 = transition((&param_3));
    _fragColor = _e17;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
