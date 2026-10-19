// SimpleFlip — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/SimpleFlip.glsl
// Author: nwoeanhinnogaehr
// License: MIT
// Description: The outgoing image flips around the vertical axis into the incoming one
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

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var q: vec2<f32>;
    var a: vec4<f32>;
    var param: vec2<f32>;
    var b: vec4<f32>;
    var param_1: vec2<f32>;

    let _e18 = (*uv_2);
    q = _e18;
    let _e20 = (*uv_2)[0u];
    let _e23 = uniforms.progress;
    (*uv_2)[0u] = ((((_e20 - 0.5f) / abs((_e23 - 0.5f))) * 0.5f) + 0.5f);
    let _e30 = (*uv_2);
    param = _e30;
    let _e31 = getFromColor((&param));
    a = _e31;
    let _e32 = (*uv_2);
    param_1 = _e32;
    let _e33 = getToColor((&param_1));
    b = _e33;
    let _e34 = a;
    let _e35 = b;
    let _e37 = uniforms.progress;
    let _e43 = q[0u];
    let _e47 = uniforms.progress;
    let _e51 = (mix(_e34, _e35, vec4(step(0.5f, _e37))).xyz * step(abs((_e43 - 0.5f)), abs((_e47 - 0.5f))));
    return vec4<f32>(_e51.x, _e51.y, _e51.z, 1f);
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
