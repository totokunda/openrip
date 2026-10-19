// BlockDissolve — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/BlockDissolve.glsl
// Author: nwoeanhinnogaehr
// License: MIT
// Description: The incoming image appears in small random blocks
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    blocksize: f32,
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

fn rand(co: ptr<function, vec2<f32>>) -> f32 {
    let _e17 = (*co);
    return fract((sin(dot(_e17, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

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
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e20 = (*uv_2);
    param = _e20;
    let _e21 = getFromColor((&param));
    let _e22 = (*uv_2);
    param_1 = _e22;
    let _e23 = getToColor((&param_1));
    let _e24 = (*uv_2);
    let _e26 = uniforms.blocksize;
    param_2 = floor((_e24 / vec2(_e26)));
    let _e30 = rand((&param_2));
    let _e32 = uniforms.progress;
    return mix(_e21, _e23, vec4(step(_e30, _e32)));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e17 = _uv_1;
    param_3 = _e17;
    let _e18 = transition((&param_3));
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
