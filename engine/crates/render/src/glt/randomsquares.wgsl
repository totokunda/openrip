// randomsquares — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/randomsquares.glsl
// Author: gre
// License: MIT
// Description: The incoming image appears in random squares
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    size: vec2<i32>,
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

fn rand(co: ptr<function, vec2<f32>>) -> f32 {
    let _e18 = (*co);
    return fract((sin(dot(_e18, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var r: f32;
    var param: vec2<f32>;
    var m: f32;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e24 = uniforms.size;
    let _e26 = (*p);
    param = floor((vec2<f32>(_e24) * _e26));
    let _e29 = rand((&param));
    r = _e29;
    let _e31 = uniforms.smoothness;
    let _e33 = r;
    let _e35 = uniforms.progress;
    let _e37 = uniforms.smoothness;
    m = smoothstep(0f, -(_e31), (_e33 - (_e35 * (1f + _e37))));
    let _e42 = (*p);
    param_1 = _e42;
    let _e43 = getFromColor((&param_1));
    let _e44 = (*p);
    param_2 = _e44;
    let _e45 = getToColor((&param_2));
    let _e46 = m;
    return mix(_e43, _e45, vec4(_e46));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e18 = _uv_1;
    param_3 = _e18;
    let _e19 = transition((&param_3));
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
