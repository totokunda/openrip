// coord-from-in — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/coord-from-in.glsl
// Author: haiyoucuv
// License: MIT
// Description: A crossfade in which the colors of one image displace the other
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

fn getFromColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e13 = (*uv)[0u];
    let _e15 = (*uv)[1u];
    let _e18 = textureSampleLevel(_from, _sampler, vec2<f32>(_e13, (1f - _e15)), 0f);
    return _e18;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e13 = (*uv_1)[0u];
    let _e15 = (*uv_1)[1u];
    let _e18 = textureSampleLevel(_to, _sampler, vec2<f32>(_e13, (1f - _e15)), 0f);
    return _e18;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var coordTo: vec4<f32>;
    var param: vec2<f32>;
    var coordFrom: vec4<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    let _e18 = (*uv_2);
    param = _e18;
    let _e19 = getToColor((&param));
    coordTo = _e19;
    let _e20 = (*uv_2);
    param_1 = _e20;
    let _e21 = getFromColor((&param_1));
    coordFrom = _e21;
    let _e22 = (*uv_2);
    let _e23 = coordTo;
    let _e26 = uniforms.progress;
    param_2 = mix(_e22, _e23.xy, vec2(_e26));
    let _e29 = getFromColor((&param_2));
    let _e30 = coordFrom;
    let _e32 = (*uv_2);
    let _e34 = uniforms.progress;
    param_3 = mix(_e30.xy, _e32, vec2(_e34));
    let _e37 = getToColor((&param_3));
    let _e39 = uniforms.progress;
    return mix(_e29, _e37, vec4(_e39));
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e12 = _uv_1;
    param_4 = _e12;
    let _e13 = transition((&param_4));
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
