// rotateTransition — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/rotateTransition.glsl
// Author: haiyoucuv
// License: MIT
// Description: The images spin around the center while crossfading
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
    let _e16 = (*uv)[0u];
    let _e18 = (*uv)[1u];
    let _e21 = textureSampleLevel(_to, _sampler, vec2<f32>(_e16, (1f - _e18)), 0f);
    return _e21;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e16 = (*uv_1)[0u];
    let _e18 = (*uv_1)[1u];
    let _e21 = textureSampleLevel(_from, _sampler, vec2<f32>(_e16, (1f - _e18)), 0f);
    return _e21;
}

fn rotate2D(uv_2: ptr<function, vec2<f32>>, angle: ptr<function, f32>) -> vec2<f32> {
    let _e16 = (*uv_2);
    let _e17 = (*angle);
    let _e19 = (*angle);
    let _e22 = (*angle);
    let _e24 = (*angle);
    return (_e16 * mat2x2<f32>(vec2<f32>(cos(_e17), -(sin(_e19))), vec2<f32>(sin(_e22), cos(_e24))));
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p: vec2<f32>;
    var param: vec2<f32>;
    var param_1: f32;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    let _e20 = (*uv_3);
    let _e24 = uniforms.progress;
    param = (_e20 - vec2(0.5f));
    param_1 = ((_e24 * 3.1415925f) * 2f);
    let _e27 = rotate2D((&param), (&param_1));
    p = fract((_e27 + vec2(0.5f)));
    let _e31 = p;
    param_2 = _e31;
    let _e32 = getFromColor((&param_2));
    let _e33 = p;
    param_3 = _e33;
    let _e34 = getToColor((&param_3));
    let _e36 = uniforms.progress;
    return mix(_e32, _e34, vec4(_e36));
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e15 = _uv_1;
    param_4 = _e15;
    let _e16 = transition((&param_4));
    _fragColor = _e16;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
