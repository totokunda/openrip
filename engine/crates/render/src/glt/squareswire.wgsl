// squareswire — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/squareswire.glsl
// Author: gre
// License: MIT
// Description: Squares grow along a diagonal sweep to reveal the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    squares: vec2<i32>,
    direction: vec2<f32>,
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var v: vec2<f32>;
    var d: f32;
    var offset: f32;
    var pr: f32;
    var squarep: vec2<f32>;
    var squaremin: vec2<f32>;
    var squaremax: vec2<f32>;
    var a: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e29 = uniforms.direction;
    v = normalize(_e29);
    let _e32 = v[0u];
    let _e35 = v[1u];
    let _e38 = v;
    v = (_e38 / vec2((abs(_e32) + abs(_e35))));
    let _e42 = v[0u];
    let _e45 = v[1u];
    d = ((_e42 * 0.5f) + (_e45 * 0.5f));
    let _e49 = uniforms.smoothness;
    offset = _e49;
    let _e50 = offset;
    let _e53 = v[0u];
    let _e55 = (*p)[0u];
    let _e58 = v[1u];
    let _e60 = (*p)[1u];
    let _e63 = d;
    let _e66 = uniforms.progress;
    let _e67 = offset;
    pr = smoothstep(-(_e50), 0f, (((_e53 * _e55) + (_e58 * _e60)) - ((_e63 - 0.5f) + (_e66 * (1f + _e67)))));
    let _e73 = (*p);
    let _e75 = uniforms.squares;
    squarep = fract((_e73 * vec2<f32>(_e75)));
    let _e79 = pr;
    squaremin = vec2((_e79 / 2f));
    let _e82 = pr;
    squaremax = vec2((1f - (_e82 / 2f)));
    let _e87 = uniforms.progress;
    let _e91 = squaremin[0u];
    let _e93 = squarep[0u];
    let _e97 = squaremin[1u];
    let _e99 = squarep[1u];
    let _e103 = squarep[0u];
    let _e105 = squaremax[0u];
    let _e109 = squarep[1u];
    let _e111 = squaremax[1u];
    a = (((((1f - step(_e87, 0f)) * step(_e91, _e93)) * step(_e97, _e99)) * step(_e103, _e105)) * step(_e109, _e111));
    let _e114 = (*p);
    param = _e114;
    let _e115 = getFromColor((&param));
    let _e116 = (*p);
    param_1 = _e116;
    let _e117 = getToColor((&param_1));
    let _e118 = a;
    return mix(_e115, _e117, vec4(_e118));
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
