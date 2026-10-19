// polar_function — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/polar_function.glsl
// Author: Fernando Kuteken
// License: MIT
// Description: A flower shape with several petals grows to reveal the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    segments: i32,
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
    let _e20 = (*uv)[0u];
    let _e22 = (*uv)[1u];
    let _e25 = textureSampleLevel(_to, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e20 = (*uv_1)[0u];
    let _e22 = (*uv_1)[1u];
    let _e25 = textureSampleLevel(_from, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var angle: f32;
    var normalized: f32;
    var radius: f32;
    var difference: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e26 = (*uv_2)[1u];
    let _e29 = (*uv_2)[0u];
    angle = (atan2((_e26 - 0.5f), (_e29 - 0.5f)) - 1.5707964f);
    let _e33 = angle;
    normalized = ((_e33 + 4.712389f) * 6.2831855f);
    let _e37 = uniforms.segments;
    let _e39 = angle;
    radius = ((cos((f32(_e37) * _e39)) + 4f) / 4f);
    let _e44 = (*uv_2);
    difference = length((_e44 - vec2<f32>(0.5f, 0.5f)));
    let _e47 = difference;
    let _e48 = radius;
    let _e50 = uniforms.progress;
    if (_e47 > (_e48 * _e50)) {
        let _e53 = (*uv_2);
        param = _e53;
        let _e54 = getFromColor((&param));
        return _e54;
    } else {
        let _e55 = (*uv_2);
        param_1 = _e55;
        let _e56 = getToColor((&param_1));
        return _e56;
    }
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e19 = _uv_1;
    param_2 = _e19;
    let _e20 = transition((&param_2));
    _fragColor = _e20;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
