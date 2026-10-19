// directionalwipe — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/directionalwipe.glsl
// Author: gre
// License: MIT
// Description: A soft-edged diagonal wipe
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
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
    var v: vec2<f32>;
    var d: f32;
    var m: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e22 = uniforms.direction;
    v = normalize(_e22);
    let _e25 = v[0u];
    let _e28 = v[1u];
    let _e31 = v;
    v = (_e31 / vec2((abs(_e25) + abs(_e28))));
    let _e35 = v[0u];
    let _e38 = v[1u];
    d = ((_e35 * 0.5f) + (_e38 * 0.5f));
    let _e42 = uniforms.progress;
    let _e46 = uniforms.smoothness;
    let _e49 = v[0u];
    let _e51 = (*uv_2)[0u];
    let _e54 = v[1u];
    let _e56 = (*uv_2)[1u];
    let _e59 = d;
    let _e62 = uniforms.progress;
    let _e64 = uniforms.smoothness;
    m = ((1f - step(_e42, 0f)) * (1f - smoothstep(-(_e46), 0f, (((_e49 * _e51) + (_e54 * _e56)) - ((_e59 - 0.5f) + (_e62 * (1f + _e64)))))));
    let _e72 = (*uv_2);
    param = _e72;
    let _e73 = getFromColor((&param));
    let _e74 = (*uv_2);
    param_1 = _e74;
    let _e75 = getToColor((&param_1));
    let _e76 = m;
    return mix(_e73, _e75, vec4(_e76));
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
