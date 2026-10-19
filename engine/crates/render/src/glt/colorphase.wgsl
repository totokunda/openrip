// colorphase — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/colorphase.glsl
// Author: gre
// License: MIT
// Description: A crossfade in which each color channel changes at a different time
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    fromStep: vec4<f32>,
    toStep: vec4<f32>,
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
    var a: vec4<f32>;
    var param: vec2<f32>;
    var b: vec4<f32>;
    var param_1: vec2<f32>;

    let _e18 = (*uv_2);
    param = _e18;
    let _e19 = getFromColor((&param));
    a = _e19;
    let _e20 = (*uv_2);
    param_1 = _e20;
    let _e21 = getToColor((&param_1));
    b = _e21;
    let _e22 = a;
    let _e23 = b;
    let _e25 = uniforms.fromStep;
    let _e27 = uniforms.toStep;
    let _e29 = uniforms.progress;
    return mix(_e22, _e23, smoothstep(_e25, _e27, vec4(_e29)));
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
