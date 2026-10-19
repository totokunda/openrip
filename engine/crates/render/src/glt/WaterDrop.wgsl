// WaterDrop — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/WaterDrop.glsl
// Author: Paweł Płóciennik
// License: MIT
// Description: Ripples spread from the center like a drop falling into water, crossfading to the incoming image
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var dir: vec2<f32>;
    var dist: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var offset: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    let _e23 = (*p);
    dir = (_e23 - vec2<f32>(0.5f, 0.5f));
    let _e25 = dir;
    dist = length(_e25);
    let _e27 = dist;
    let _e29 = uniforms.progress;
    if (_e27 > _e29) {
        let _e31 = (*p);
        param = _e31;
        let _e32 = getFromColor((&param));
        let _e33 = (*p);
        param_1 = _e33;
        let _e34 = getToColor((&param_1));
        let _e36 = uniforms.progress;
        return mix(_e32, _e34, vec4(_e36));
    } else {
        let _e39 = dir;
        let _e40 = dist;
        let _e42 = uniforms.amplitude;
        let _e45 = uniforms.progress;
        let _e47 = uniforms.speed;
        offset = (_e39 * sin(((_e40 * _e42) - (_e45 * _e47))));
        let _e52 = (*p);
        let _e53 = offset;
        param_2 = (_e52 + _e53);
        let _e55 = getFromColor((&param_2));
        let _e56 = (*p);
        param_3 = _e56;
        let _e57 = getToColor((&param_3));
        let _e59 = uniforms.progress;
        return mix(_e55, _e57, vec4(_e59));
    }
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e16 = _uv_1;
    param_4 = _e16;
    let _e17 = transition((&param_4));
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
