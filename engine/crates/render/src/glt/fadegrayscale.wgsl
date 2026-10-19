// fadegrayscale — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/fadegrayscale.glsl
// Author: gre
// License: MIT
// Description: A crossfade through grayscale
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    intensity: f32,
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

fn grayscale(color: ptr<function, vec3<f32>>) -> vec3<f32> {
    let _e18 = (*color)[0u];
    let _e21 = (*color)[1u];
    let _e25 = (*color)[2u];
    return vec3((((0.2126f * _e18) + (0.7152f * _e21)) + (0.0722f * _e25)));
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
    var fc: vec4<f32>;
    var param: vec2<f32>;
    var tc: vec4<f32>;
    var param_1: vec2<f32>;
    var param_2: vec3<f32>;
    var param_3: vec3<f32>;

    let _e23 = (*uv_2);
    param = _e23;
    let _e24 = getFromColor((&param));
    fc = _e24;
    let _e25 = (*uv_2);
    param_1 = _e25;
    let _e26 = getToColor((&param_1));
    tc = _e26;
    let _e27 = fc;
    param_2 = _e27.xyz;
    let _e29 = grayscale((&param_2));
    let _e34 = fc;
    let _e36 = uniforms.intensity;
    let _e39 = uniforms.progress;
    let _e43 = tc;
    param_3 = _e43.xyz;
    let _e45 = grayscale((&param_3));
    let _e50 = tc;
    let _e52 = uniforms.intensity;
    let _e54 = uniforms.progress;
    let _e59 = uniforms.progress;
    return mix(mix(vec4<f32>(_e29.x, _e29.y, _e29.z, 1f), _e34, vec4(smoothstep((1f - _e36), 0f, _e39))), mix(vec4<f32>(_e45.x, _e45.y, _e45.z, 1f), _e50, vec4(smoothstep(_e52, 1f, _e54))), vec4(_e59));
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e17 = _uv_1;
    param_4 = _e17;
    let _e18 = transition((&param_4));
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
