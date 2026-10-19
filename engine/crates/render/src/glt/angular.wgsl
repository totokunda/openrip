// angular — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/angular.glsl
// Author: Fernando Kuteken
// License: MIT
// Description: A wipe that sweeps around the center from a starting angle
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    startingAngle: f32,
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
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var offset: f32;
    var angle: f32;
    var normalizedAngle: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e23 = uniforms.startingAngle;
    offset = ((_e23 * 3.1415927f) / 180f);
    let _e27 = (*uv_2)[1u];
    let _e30 = (*uv_2)[0u];
    let _e33 = offset;
    angle = (atan2((_e27 - 0.5f), (_e30 - 0.5f)) + _e33);
    let _e35 = angle;
    normalizedAngle = ((_e35 + 3.1415927f) / 6.2831855f);
    let _e38 = normalizedAngle;
    let _e39 = normalizedAngle;
    normalizedAngle = (_e38 - floor(_e39));
    let _e42 = (*uv_2);
    param = _e42;
    let _e43 = getFromColor((&param));
    let _e44 = (*uv_2);
    param_1 = _e44;
    let _e45 = getToColor((&param_1));
    let _e46 = normalizedAngle;
    let _e48 = uniforms.progress;
    return mix(_e43, _e45, vec4(step(_e46, _e48)));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e17 = _uv_1;
    param_2 = _e17;
    let _e18 = transition((&param_2));
    _fragColor = _e18;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
