// directional-easing — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/directional-easing.glsl
// Author: Max Plotnikov
// License: MIT
// Description: Like Directional, with an eased movement
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    direction: vec2<f32>,
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
    let _e15 = (*uv)[0u];
    let _e17 = (*uv)[1u];
    let _e20 = textureSampleLevel(_from, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e15 = (*uv_1)[0u];
    let _e17 = (*uv_1)[1u];
    let _e20 = textureSampleLevel(_to, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var easing: f32;
    var p: vec2<f32>;
    var f: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e20 = uniforms.progress;
    let _e23 = uniforms.progress;
    easing = sqrt(((2f - _e20) * _e23));
    let _e26 = (*uv_2);
    let _e27 = easing;
    let _e29 = uniforms.direction;
    p = (_e26 + (sign(_e29) * _e27));
    let _e33 = p;
    f = fract(_e33);
    let _e35 = f;
    param = _e35;
    let _e36 = getToColor((&param));
    let _e37 = f;
    param_1 = _e37;
    let _e38 = getFromColor((&param_1));
    let _e40 = p[1u];
    let _e43 = p[1u];
    let _e47 = p[0u];
    let _e51 = p[0u];
    return mix(_e36, _e38, vec4((((step(0f, _e40) * step(_e43, 1f)) * step(0f, _e47)) * step(_e51, 1f))));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e14 = _uv_1;
    param_2 = _e14;
    let _e15 = transition((&param_2));
    _fragColor = _e15;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
