// ColourDistance — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/ColourDistance.glsl
// Author: P-Seebauer
// License: MIT
// Description: Pixels switch to the incoming image in order of how close their colors are
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    power: f32,
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var fTex: vec4<f32>;
    var param: vec2<f32>;
    var tTex: vec4<f32>;
    var param_1: vec2<f32>;
    var m: f32;

    let _e18 = (*p);
    param = _e18;
    let _e19 = getFromColor((&param));
    fTex = _e19;
    let _e20 = (*p);
    param_1 = _e20;
    let _e21 = getToColor((&param_1));
    tTex = _e21;
    let _e22 = fTex;
    let _e23 = tTex;
    let _e26 = uniforms.progress;
    m = step(distance(_e22, _e23), _e26);
    let _e28 = fTex;
    let _e29 = tTex;
    let _e30 = m;
    let _e33 = tTex;
    let _e35 = uniforms.progress;
    let _e37 = uniforms.power;
    return mix(mix(_e28, _e29, vec4(_e30)), _e33, vec4(pow(_e35, _e37)));
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
