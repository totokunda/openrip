// ripple — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/ripple.glsl
// Author: gre
// License: MIT
// Description: Ripples spread from the center while crossfading
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    amplitude: f32,
    speed: f32,
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
    let _e19 = (*uv)[0u];
    let _e21 = (*uv)[1u];
    let _e24 = textureSampleLevel(_to, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e19 = (*uv_1)[0u];
    let _e21 = (*uv_1)[1u];
    let _e24 = textureSampleLevel(_from, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var dir: vec2<f32>;
    var dist: f32;
    var offset: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e23 = (*uv_2);
    dir = (_e23 - vec2<f32>(0.5f, 0.5f));
    let _e25 = dir;
    dist = length(_e25);
    let _e27 = dir;
    let _e29 = uniforms.progress;
    let _e30 = dist;
    let _e33 = uniforms.amplitude;
    let _e36 = uniforms.progress;
    let _e38 = uniforms.speed;
    let _e47 = uniforms.progress;
    offset = (((_e27 * (sin((((_e29 * _e30) * _e33) - (_e36 * _e38))) + 0.5f)) / vec2(30f)) * _e47);
    let _e49 = (*uv_2);
    let _e50 = offset;
    param = (_e49 + _e50);
    let _e52 = getFromColor((&param));
    let _e53 = (*uv_2);
    param_1 = _e53;
    let _e54 = getToColor((&param_1));
    let _e56 = uniforms.progress;
    return mix(_e52, _e54, vec4(smoothstep(0.2f, 1f, _e56)));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e18 = _uv_1;
    param_2 = _e18;
    let _e19 = transition((&param_2));
    _fragColor = _e19;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
