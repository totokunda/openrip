// Bounce — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Bounce.glsl
// Author: Adrian Purser
// License: MIT
// Description: The outgoing image drops out of the frame with a few bounces, revealing the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    shadow_colour: vec4<f32>,
    shadow_height: f32,
    bounces: f32,
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

fn getFromColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e20 = (*uv)[0u];
    let _e22 = (*uv)[1u];
    let _e25 = textureSampleLevel(_from, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e20 = (*uv_1)[0u];
    let _e22 = (*uv_1)[1u];
    let _e25 = textureSampleLevel(_to, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var time: f32;
    var stime: f32;
    var phase: f32;
    var y: f32;
    var d: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e27 = uniforms.progress;
    time = _e27;
    let _e28 = time;
    stime = sin(((_e28 * 3.1415927f) / 2f));
    let _e32 = time;
    let _e35 = uniforms.bounces;
    phase = ((_e32 * 3.1415927f) * _e35);
    let _e37 = phase;
    let _e40 = stime;
    y = (abs(cos(_e37)) * (1f - _e40));
    let _e44 = (*uv_2)[1u];
    let _e45 = y;
    d = (_e44 - _e45);
    let _e47 = (*uv_2);
    param = _e47;
    let _e48 = getToColor((&param));
    let _e50 = uniforms.shadow_colour;
    let _e51 = d;
    let _e53 = uniforms.shadow_height;
    let _e55 = d;
    let _e57 = uniforms.shadow_height;
    let _e61 = uniforms.shadow_colour[3u];
    let _e65 = uniforms.shadow_colour[3u];
    let _e69 = uniforms.progress;
    let _e77 = (*uv_2)[0u];
    let _e79 = (*uv_2)[1u];
    let _e80 = y;
    param_1 = vec2<f32>(_e77, (_e79 + (1f - _e80)));
    let _e84 = getFromColor((&param_1));
    let _e85 = d;
    return mix(mix(_e48, _e50, vec4((step(_e51, _e53) * (1f - mix((((_e55 / _e57) * _e61) + (1f - _e65)), 1f, smoothstep(0.95f, 1f, _e69)))))), _e84, vec4(step(_e85, 0f)));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e19 = _uv_1;
    param_2 = _e19;
    let _e20 = transition((&param_2));
    _fragColor = _e20;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
