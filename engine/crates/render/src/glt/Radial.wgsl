// Radial — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Radial.glsl
// Author: Xaychru
// License: MIT
// Description: A radial wipe that sweeps around the center like a clock hand
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    smoothness: f32,
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
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var rp: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e20 = (*p);
    rp = ((_e20 * 2f) - vec2(1f));
    let _e24 = (*p);
    param = _e24;
    let _e25 = getToColor((&param));
    let _e26 = (*p);
    param_1 = _e26;
    let _e27 = getFromColor((&param_1));
    let _e29 = uniforms.smoothness;
    let _e31 = rp[1u];
    let _e33 = rp[0u];
    let _e36 = uniforms.progress;
    return mix(_e25, _e27, vec4(smoothstep(0f, _e29, (atan2(_e31, _e33) - (((_e36 - 0.5f) * 3.1415927f) * 2.5f)))));
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
