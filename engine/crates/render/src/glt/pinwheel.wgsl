// pinwheel — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/pinwheel.glsl
// Author: Mr Speaker
// License: MIT
// Description: A spinning pinwheel reveals the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    speed: f32,
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
    let _e17 = (*uv)[0u];
    let _e19 = (*uv)[1u];
    let _e22 = textureSampleLevel(_from, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv_1)[0u];
    let _e19 = (*uv_1)[1u];
    let _e22 = textureSampleLevel(_to, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p: vec2<f32>;
    var circPos: f32;
    var modPos: f32;
    var signed: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e22 = (*uv_2);
    p = (_e22 / vec2<f32>(1f, 1f));
    let _e25 = p[1u];
    let _e28 = p[0u];
    let _e32 = uniforms.progress;
    let _e34 = uniforms.speed;
    circPos = (atan2((_e25 - 0.5f), (_e28 - 0.5f)) + (_e32 * _e34));
    let _e37 = circPos;
    modPos = (_e37 - (floor((_e37 / 0.785375f)) * 0.785375f));
    let _e43 = uniforms.progress;
    let _e44 = modPos;
    signed = sign((_e43 - _e44));
    let _e47 = p;
    param = _e47;
    let _e48 = getToColor((&param));
    let _e49 = p;
    param_1 = _e49;
    let _e50 = getFromColor((&param_1));
    let _e51 = signed;
    return mix(_e48, _e50, vec4(step(_e51, 0.5f)));
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
