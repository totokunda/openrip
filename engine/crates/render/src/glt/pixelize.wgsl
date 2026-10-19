// pixelize — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/pixelize.glsl
// Author: gre
// License: MIT
// Description: Both images pixelate, crossfade, then sharpen again
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    squaresMin: vec2<i32>,
    steps: i32,
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
    var d: f32;
    var dist: f32;
    var local: f32;
    var squareSize: vec2<f32>;
    var p: vec2<f32>;
    var local_1: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e25 = uniforms.progress;
    let _e27 = uniforms.progress;
    d = min(_e25, (1f - _e27));
    let _e31 = uniforms.steps;
    if (_e31 > 0i) {
        let _e33 = d;
        let _e35 = uniforms.steps;
        let _e40 = uniforms.steps;
        local = (ceil((_e33 * f32(_e35))) / f32(_e40));
    } else {
        let _e43 = d;
        local = _e43;
    }
    let _e44 = local;
    dist = _e44;
    let _e45 = dist;
    let _e48 = uniforms.squaresMin;
    squareSize = (vec2((2f * _e45)) / vec2<f32>(_e48));
    let _e52 = dist;
    if (_e52 > 0f) {
        let _e54 = (*uv_2);
        let _e55 = squareSize;
        let _e60 = squareSize;
        local_1 = ((floor((_e54 / _e55)) + vec2(0.5f)) * _e60);
    } else {
        let _e62 = (*uv_2);
        local_1 = _e62;
    }
    let _e63 = local_1;
    p = _e63;
    let _e64 = p;
    param = _e64;
    let _e65 = getFromColor((&param));
    let _e66 = p;
    param_1 = _e66;
    let _e67 = getToColor((&param_1));
    let _e69 = uniforms.progress;
    return mix(_e65, _e67, vec4(_e69));
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
