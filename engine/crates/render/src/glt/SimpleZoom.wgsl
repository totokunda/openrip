// SimpleZoom — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/SimpleZoom.glsl
// Author: 0gust1
// License: MIT
// Description: Zooms into the outgoing image, then fades to the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    zoom_quickness: f32,
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

fn zoom(uv_2: ptr<function, vec2<f32>>, amount: ptr<function, f32>) -> vec2<f32> {
    let _e16 = (*uv_2);
    let _e19 = (*amount);
    return (vec2(0.5f) + ((_e16 - vec2(0.5f)) * (1f - _e19)));
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var nQuick: f32;
    var param: vec2<f32>;
    var param_1: f32;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    let _e21 = uniforms.zoom_quickness;
    nQuick = clamp(_e21, 0.2f, 1f);
    let _e23 = nQuick;
    let _e25 = uniforms.progress;
    let _e27 = (*uv_3);
    param = _e27;
    param_1 = smoothstep(0f, _e23, _e25);
    let _e28 = zoom((&param), (&param_1));
    param_2 = _e28;
    let _e29 = getFromColor((&param_2));
    let _e30 = (*uv_3);
    param_3 = _e30;
    let _e31 = getToColor((&param_3));
    let _e32 = nQuick;
    let _e35 = uniforms.progress;
    return mix(_e29, _e31, vec4(smoothstep((_e32 - 0.2f), 1f, _e35)));
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
