// VerticalOpen — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/VerticalOpen.glsl
// Author: martiniti
// License: MIT
// Description: The incoming image opens from a line in the middle toward the left and right edges
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
    let _e15 = (*uv)[0u];
    let _e17 = (*uv)[1u];
    let _e20 = textureSampleLevel(_to, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e15 = (*uv_1)[0u];
    let _e17 = (*uv_1)[1u];
    let _e20 = textureSampleLevel(_from, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var regress: f32;
    var s: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e19 = uniforms.progress;
    regress = (1f - _e19);
    let _e22 = (*uv_2)[0u];
    let _e24 = regress;
    let _e29 = regress;
    s = ((2f - abs(((_e22 - 0.5f) / (_e24 - 1f)))) - (2f * _e29));
    let _e32 = (*uv_2);
    param = _e32;
    let _e33 = getFromColor((&param));
    let _e34 = (*uv_2);
    param_1 = _e34;
    let _e35 = getToColor((&param_1));
    let _e36 = s;
    return mix(_e33, _e35, vec4(smoothstep(0f, 0.5f, _e36)));
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
