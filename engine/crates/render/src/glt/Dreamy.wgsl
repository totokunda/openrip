// Dreamy — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Dreamy.glsl
// Author: mikolalysenko
// License: MIT
// Description: A crossfade with a gentle wavy distortion
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

fn offset(progress: ptr<function, f32>, x: ptr<function, f32>, theta: ptr<function, f32>) -> vec2<f32> {
    var phase: f32;
    var shifty: f32;

    let _e19 = (*progress);
    let _e20 = (*progress);
    let _e22 = (*progress);
    let _e24 = (*theta);
    phase = (((_e19 * _e20) + _e22) + _e24);
    let _e26 = (*progress);
    let _e28 = (*progress);
    let _e29 = (*x);
    shifty = ((0.03f * _e26) * cos((10f * (_e28 + _e29))));
    let _e34 = shifty;
    return vec2<f32>(0f, _e34);
}

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param: f32;
    var param_1: f32;
    var param_2: f32;
    var param_3: vec2<f32>;
    var param_4: f32;
    var param_5: f32;
    var param_6: f32;
    var param_7: vec2<f32>;

    let _e23 = (*p);
    let _e25 = uniforms.progress;
    param = _e25;
    let _e27 = (*p)[0u];
    param_1 = _e27;
    param_2 = 0f;
    let _e28 = offset((&param), (&param_1), (&param_2));
    param_3 = (_e23 + _e28);
    let _e30 = getFromColor((&param_3));
    let _e31 = (*p);
    let _e33 = uniforms.progress;
    param_4 = (1f - _e33);
    let _e36 = (*p)[0u];
    param_5 = _e36;
    param_6 = 3.14f;
    let _e37 = offset((&param_4), (&param_5), (&param_6));
    param_7 = (_e31 + _e37);
    let _e39 = getToColor((&param_7));
    let _e41 = uniforms.progress;
    return mix(_e30, _e39, vec4(_e41));
}

fn main_1() {
    var param_8: vec2<f32>;

    let _e15 = _uv_1;
    param_8 = _e15;
    let _e16 = transition((&param_8));
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
