// Overexposure — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Overexposure.glsl
// Author: Ben Zhang
// License: MIT
// Description: A crossfade through a washed-out, overexposed white
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    strength: f32,
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
    let _e17 = (*uv)[0u];
    let _e19 = (*uv)[1u];
    let _e22 = textureSampleLevel(_to, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv_1)[0u];
    let _e19 = (*uv_1)[1u];
    let _e22 = textureSampleLevel(_from, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var from_: vec4<f32>;
    var param: vec2<f32>;
    var to: vec4<f32>;
    var param_1: vec2<f32>;
    var from_m: f32;
    var to_m: f32;

    let _e22 = (*uv_2);
    param = _e22;
    let _e23 = getFromColor((&param));
    from_ = _e23;
    let _e24 = (*uv_2);
    param_1 = _e24;
    let _e25 = getToColor((&param_1));
    to = _e25;
    let _e27 = uniforms.progress;
    let _e30 = uniforms.progress;
    let _e34 = uniforms.strength;
    from_m = ((1f - _e27) + (sin((3.1415927f * _e30)) * _e34));
    let _e38 = uniforms.progress;
    let _e40 = uniforms.progress;
    let _e44 = uniforms.strength;
    to_m = (_e38 + (sin((3.1415927f * _e40)) * _e44));
    let _e48 = from_[0u];
    let _e50 = from_[3u];
    let _e52 = from_m;
    let _e55 = to[0u];
    let _e57 = to[3u];
    let _e59 = to_m;
    let _e63 = from_[1u];
    let _e65 = from_[3u];
    let _e67 = from_m;
    let _e70 = to[1u];
    let _e72 = to[3u];
    let _e74 = to_m;
    let _e78 = from_[2u];
    let _e80 = from_[3u];
    let _e82 = from_m;
    let _e85 = to[2u];
    let _e87 = to[3u];
    let _e89 = to_m;
    let _e93 = from_[3u];
    let _e95 = to[3u];
    let _e97 = uniforms.progress;
    return vec4<f32>((((_e48 * _e50) * _e52) + ((_e55 * _e57) * _e59)), (((_e63 * _e65) * _e67) + ((_e70 * _e72) * _e74)), (((_e78 * _e80) * _e82) + ((_e85 * _e87) * _e89)), mix(_e93, _e95, _e97));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e16 = _uv_1;
    param_2 = _e16;
    let _e17 = transition((&param_2));
    _fragColor = _e17;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
