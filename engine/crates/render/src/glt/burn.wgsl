// burn — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/burn.glsl
// Author: gre
// License: MIT
// Description: A crossfade that brightens toward a color in the middle
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    color: vec3<f32>,
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
    let _e14 = (*uv)[0u];
    let _e16 = (*uv)[1u];
    let _e19 = textureSampleLevel(_to, _sampler, vec2<f32>(_e14, (1f - _e16)), 0f);
    return _e19;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e14 = (*uv_1)[0u];
    let _e16 = (*uv_1)[1u];
    let _e19 = textureSampleLevel(_from, _sampler, vec2<f32>(_e14, (1f - _e16)), 0f);
    return _e19;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e15 = (*uv_2);
    param = _e15;
    let _e16 = getFromColor((&param));
    let _e18 = uniforms.progress;
    let _e20 = uniforms.color;
    let _e21 = (_e20 * _e18);
    let _e27 = (*uv_2);
    param_1 = _e27;
    let _e28 = getToColor((&param_1));
    let _e30 = uniforms.progress;
    let _e33 = uniforms.color;
    let _e34 = (_e33 * (1f - _e30));
    let _e41 = uniforms.progress;
    return mix((_e16 + vec4<f32>(_e21.x, _e21.y, _e21.z, 1f)), (_e28 + vec4<f32>(_e34.x, _e34.y, _e34.z, 1f)), vec4(_e41));
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
