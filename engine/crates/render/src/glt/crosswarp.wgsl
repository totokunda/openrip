// crosswarp — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/crosswarp.glsl
// Author: Eke Péter <peterekepeter@gmail.com>
// License: MIT
// Description: The outgoing image zooms in while the incoming one zooms out into place, sweeping from right to left
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var x: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e18 = uniforms.progress;
    x = _e18;
    let _e19 = x;
    let _e22 = (*p)[0u];
    x = smoothstep(0f, 1f, (((_e19 * 2f) + _e22) - 1f));
    let _e26 = (*p);
    let _e29 = x;
    param = (((_e26 - vec2(0.5f)) * (1f - _e29)) + vec2(0.5f));
    let _e34 = getFromColor((&param));
    let _e35 = (*p);
    let _e38 = x;
    param_1 = (((_e35 - vec2(0.5f)) * _e38) + vec2(0.5f));
    let _e42 = getToColor((&param_1));
    let _e43 = x;
    return mix(_e34, _e42, vec4(_e43));
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
