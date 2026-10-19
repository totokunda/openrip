// x_axis_translation — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/x_axis_translation.glsl
// Author: lizhongjian
// License: MIT
// Description: The outgoing image slides to the right, uncovering a crossfade to the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
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
    let _e13 = (*uv)[0u];
    let _e15 = (*uv)[1u];
    let _e18 = textureSampleLevel(_to, _sampler, vec2<f32>(_e13, (1f - _e15)), 0f);
    return _e18;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e13 = (*uv_1)[0u];
    let _e15 = (*uv_1)[1u];
    let _e18 = textureSampleLevel(_from, _sampler, vec2<f32>(_e13, (1f - _e15)), 0f);
    return _e18;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var newUV: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e16 = (*uv_2);
    newUV = _e16;
    let _e18 = uniforms.progress;
    let _e20 = newUV[0u];
    newUV[0u] = (_e20 - _e18);
    let _e24 = (*uv_2)[0u];
    let _e26 = uniforms.progress;
    if (_e24 >= _e26) {
        let _e28 = newUV;
        param = _e28;
        let _e29 = getFromColor((&param));
        return _e29;
    }
    let _e30 = (*uv_2);
    param_1 = _e30;
    let _e31 = getFromColor((&param_1));
    let _e32 = (*uv_2);
    param_2 = _e32;
    let _e33 = getToColor((&param_2));
    let _e35 = uniforms.progress;
    return mix(_e31, _e33, vec4(_e35));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e12 = _uv_1;
    param_3 = _e12;
    let _e13 = transition((&param_3));
    _fragColor = _e13;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
