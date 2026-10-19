// scale-in — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/scale-in.glsl
// Author: haiyoucuv
// License: MIT
// Description: The incoming image scales in from the center while fading in
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
    let _e14 = (*uv)[0u];
    let _e16 = (*uv)[1u];
    let _e19 = textureSampleLevel(_to, _sampler, vec2<f32>(_e14, (1f - _e16)), 0f);
    return _e19;
}

fn scale(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param: vec2<f32>;

    let _e14 = (*uv_1);
    let _e18 = uniforms.progress;
    (*uv_1) = (vec2(0.5f) + ((_e14 - vec2(0.5f)) * _e18));
    let _e22 = (*uv_1);
    param = _e22;
    let _e23 = getToColor((&param));
    return _e23;
}

fn getFromColor(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e14 = (*uv_2)[0u];
    let _e16 = (*uv_2)[1u];
    let _e19 = textureSampleLevel(_from, _sampler, vec2<f32>(_e14, (1f - _e16)), 0f);
    return _e19;
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e15 = (*uv_3);
    param_1 = _e15;
    let _e16 = getFromColor((&param_1));
    let _e17 = (*uv_3);
    param_2 = _e17;
    let _e18 = scale((&param_2));
    let _e20 = uniforms.progress;
    return mix(_e16, _e18, vec4(_e20));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e13 = _uv_1;
    param_3 = _e13;
    let _e14 = transition((&param_3));
    _fragColor = _e14;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
