// CrazyParametricFun — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/CrazyParametricFun.glsl
// Author: mandubian
// License: MIT
// Description: The outgoing image is pulled along a parametric curve into a psychedelic swirl
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    a: f32,
    b: f32,
    amplitude: f32,
    smoothness: f32,
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
    let _e21 = (*uv)[0u];
    let _e23 = (*uv)[1u];
    let _e26 = textureSampleLevel(_to, _sampler, vec2<f32>(_e21, (1f - _e23)), 0f);
    return _e26;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e21 = (*uv_1)[0u];
    let _e23 = (*uv_1)[1u];
    let _e26 = textureSampleLevel(_from, _sampler, vec2<f32>(_e21, (1f - _e23)), 0f);
    return _e26;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p: vec2<f32>;
    var dir: vec2<f32>;
    var dist: f32;
    var x: f32;
    var y: f32;
    var offset: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e28 = (*uv_2);
    p = (_e28 / vec2<f32>(1f, 1f));
    let _e30 = p;
    dir = (_e30 - vec2<f32>(0.5f, 0.5f));
    let _e32 = dir;
    dist = length(_e32);
    let _e35 = uniforms.a;
    let _e37 = uniforms.b;
    let _e40 = uniforms.progress;
    let _e44 = uniforms.b;
    let _e46 = uniforms.progress;
    let _e48 = uniforms.a;
    let _e50 = uniforms.b;
    x = (((_e35 - _e37) * cos(_e40)) + (_e44 * cos((_e46 * ((_e48 / _e50) - 1f)))));
    let _e58 = uniforms.a;
    let _e60 = uniforms.b;
    let _e63 = uniforms.progress;
    let _e67 = uniforms.b;
    let _e69 = uniforms.progress;
    let _e71 = uniforms.a;
    let _e73 = uniforms.b;
    y = (((_e58 - _e60) * sin(_e63)) - (_e67 * sin((_e69 * ((_e71 / _e73) - 1f)))));
    let _e80 = dir;
    let _e82 = uniforms.progress;
    let _e83 = dist;
    let _e86 = uniforms.amplitude;
    let _e88 = x;
    let _e92 = uniforms.progress;
    let _e93 = dist;
    let _e96 = uniforms.amplitude;
    let _e98 = y;
    let _e104 = uniforms.smoothness;
    offset = ((_e80 * vec2<f32>(sin((((_e82 * _e83) * _e86) * _e88)), sin((((_e92 * _e93) * _e96) * _e98)))) / vec2(_e104));
    let _e107 = p;
    let _e108 = offset;
    param = (_e107 + _e108);
    let _e110 = getFromColor((&param));
    let _e111 = p;
    param_1 = _e111;
    let _e112 = getToColor((&param_1));
    let _e114 = uniforms.progress;
    return mix(_e110, _e112, vec4(smoothstep(0.2f, 1f, _e114)));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e20 = _uv_1;
    param_2 = _e20;
    let _e21 = transition((&param_2));
    _fragColor = _e21;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
