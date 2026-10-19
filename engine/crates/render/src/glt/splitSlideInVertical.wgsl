// splitSlideInVertical — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/splitSlideInVertical.glsl
// Author: OllyOllyOlly
// License: MIT
// Description: The incoming image slides in as two halves moving vertically in opposite directions
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    reverse: i32,
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
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn inBounds(p: ptr<function, vec2<f32>>) -> bool {
    var phi_74_: bool;

    let _e17 = (*p);
    let _e19 = all((vec2<f32>(0f, 0f) < _e17));
    phi_74_ = _e19;
    if _e19 {
        let _e20 = (*p);
        phi_74_ = all((_e20 < vec2<f32>(1f, 1f)));
    }
    let _e24 = phi_74_;
    return _e24;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var modifier: f32;
    var p_1: vec2<f32>;
    var local: vec2<f32>;
    var param: vec2<f32>;
    var local_1: vec4<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e25 = uniforms.reverse;
    modifier = select(1f, -1f, (_e25 != 0i));
    let _e29 = (*uv_2)[0u];
    if (_e29 > 0.5f) {
        let _e32 = (*uv_2)[0u];
        let _e34 = (*uv_2)[1u];
        let _e36 = uniforms.progress;
        let _e37 = modifier;
        let _e40 = modifier;
        local = vec2<f32>(_e32, ((_e34 - (_e36 * _e37)) + _e40));
    } else {
        let _e44 = (*uv_2)[0u];
        let _e46 = (*uv_2)[1u];
        let _e48 = uniforms.progress;
        let _e49 = modifier;
        let _e52 = modifier;
        local = vec2<f32>(_e44, ((_e46 + (_e48 * _e49)) - _e52));
    }
    let _e55 = local;
    p_1 = _e55;
    let _e56 = p_1;
    param = _e56;
    let _e57 = inBounds((&param));
    if _e57 {
        let _e58 = p_1;
        param_1 = _e58;
        let _e59 = getToColor((&param_1));
        local_1 = _e59;
    } else {
        let _e60 = (*uv_2);
        param_2 = _e60;
        let _e61 = getFromColor((&param_2));
        local_1 = _e61;
    }
    let _e62 = local_1;
    return _e62;
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e17 = _uv_1;
    param_3 = _e17;
    let _e18 = transition((&param_3));
    _fragColor = _e18;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
