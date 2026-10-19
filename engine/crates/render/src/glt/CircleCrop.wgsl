// CircleCrop — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/CircleCrop.glsl
// Author: fkuteken
// License: MIT
// Description: The outgoing image closes into a circle over a background color, then the incoming one opens from it
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    bgcolor: vec4<f32>,
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var ratio2_: vec2<f32>;
    var s: f32;
    var dist: f32;
    var local: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e24 = uniforms.ratio;
    ratio2_ = vec2<f32>(1f, (1f / _e24));
    let _e28 = uniforms.progress;
    s = pow((2f * abs((_e28 - 0.5f))), 3f);
    let _e33 = (*p);
    let _e36 = ratio2_;
    dist = length(((_e33 - vec2(0.5f)) * _e36));
    let _e40 = uniforms.progress;
    if (_e40 < 0.5f) {
        let _e42 = (*p);
        param = _e42;
        let _e43 = getFromColor((&param));
        local = _e43;
    } else {
        let _e44 = (*p);
        param_1 = _e44;
        let _e45 = getToColor((&param_1));
        local = _e45;
    }
    let _e46 = local;
    let _e48 = uniforms.bgcolor;
    let _e49 = s;
    let _e50 = dist;
    return mix(_e46, _e48, vec4(step(_e49, _e50)));
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
