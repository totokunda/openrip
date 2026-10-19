// Directional — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Directional.glsl
// Author: Gaëtan Renaudeau
// License: MIT
// Description: The incoming image pushes the outgoing one out in a given direction
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
    let _e14 = (*uv)[0u];
    let _e16 = (*uv)[1u];
    let _e19 = textureSampleLevel(_from, _sampler, vec2<f32>(_e14, (1f - _e16)), 0f);
    return _e19;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e14 = (*uv_1)[0u];
    let _e16 = (*uv_1)[1u];
    let _e19 = textureSampleLevel(_to, _sampler, vec2<f32>(_e14, (1f - _e16)), 0f);
    return _e19;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p: vec2<f32>;
    var f: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e17 = (*uv_2);
    let _e19 = uniforms.progress;
    let _e21 = uniforms.direction;
    p = (_e17 + (sign(_e21) * _e19));
    let _e25 = p;
    f = fract(_e25);
    let _e27 = f;
    param = _e27;
    let _e28 = getToColor((&param));
    let _e29 = f;
    param_1 = _e29;
    let _e30 = getFromColor((&param_1));
    let _e32 = p[1u];
    let _e35 = p[1u];
    let _e39 = p[0u];
    let _e43 = p[0u];
    return mix(_e28, _e30, vec4((((step(0f, _e32) * step(_e35, 1f)) * step(0f, _e39)) * step(_e43, 1f))));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e13 = _uv_1;
    param_2 = _e13;
    let _e14 = transition((&param_2));
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
