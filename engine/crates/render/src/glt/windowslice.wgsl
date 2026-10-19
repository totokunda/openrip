// windowslice — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/windowslice.glsl
// Author: gre
// License: MIT
// Description: The incoming image appears through vertical slices that widen
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    count: f32,
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var pr: f32;
    var s: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e19 = uniforms.smoothness;
    let _e22 = (*p)[0u];
    let _e24 = uniforms.progress;
    let _e26 = uniforms.smoothness;
    pr = smoothstep(-(_e19), 0f, (_e22 - (_e24 * (1f + _e26))));
    let _e31 = pr;
    let _e33 = uniforms.count;
    let _e35 = (*p)[0u];
    s = step(_e31, fract((_e33 * _e35)));
    let _e39 = (*p);
    param = _e39;
    let _e40 = getFromColor((&param));
    let _e41 = (*p);
    param_1 = _e41;
    let _e42 = getToColor((&param_1));
    let _e43 = s;
    return mix(_e40, _e42, vec4(_e43));
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
