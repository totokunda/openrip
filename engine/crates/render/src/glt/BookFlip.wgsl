// BookFlip — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/BookFlip.glsl
// Author: hong
// License: MIT
// Description: The outgoing image turns like a book page from right to left, revealing the incoming one
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

fn nonZero(x: ptr<function, f32>) -> f32 {
    var local: f32;

    let _e18 = (*x);
    if (abs(_e18) < 0.0001f) {
        let _e21 = (*x);
        local = select(0.0001f, -0.0001f, (_e21 < 0f));
    } else {
        let _e24 = (*x);
        local = _e24;
    }
    let _e25 = local;
    return _e25;
}

fn skewRight(p: ptr<function, vec2<f32>>) -> vec2<f32> {
    var skewX: f32;
    var param: f32;
    var skewY: f32;

    let _e21 = (*p)[0u];
    let _e23 = uniforms.progress;
    let _e26 = uniforms.progress;
    param = (0.5f - _e26);
    let _e28 = nonZero((&param));
    skewX = (((_e21 - _e23) / _e28) * 0.5f);
    let _e32 = (*p)[1u];
    let _e35 = uniforms.progress;
    let _e37 = (*p)[0u];
    skewY = ((((_e32 - 0.5f) / (0.5f + ((_e35 * (_e37 - 0.5f)) / 0.5f))) * 0.5f) + 0.5f);
    let _e45 = skewX;
    let _e46 = skewY;
    return vec2<f32>(_e45, _e46);
}

fn addShade_u0028_() -> vec4<f32> {
    var shadeVal: f32;

    let _e18 = uniforms.progress;
    shadeVal = max(0.7f, (abs((_e18 - 0.5f)) * 2f));
    let _e23 = shadeVal;
    let _e24 = vec3(_e23);
    return vec4<f32>(_e24.x, _e24.y, _e24.z, 1f);
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn skewLeft(p_1: ptr<function, vec2<f32>>) -> vec2<f32> {
    var skewX_1: f32;
    var param_1: f32;
    var skewY_1: f32;

    let _e21 = (*p_1)[0u];
    let _e24 = uniforms.progress;
    param_1 = (_e24 - 0.5f);
    let _e26 = nonZero((&param_1));
    skewX_1 = ((((_e21 - 0.5f) / _e26) * 0.5f) + 0.5f);
    let _e31 = (*p_1)[1u];
    let _e34 = uniforms.progress;
    let _e37 = (*p_1)[0u];
    skewY_1 = ((((_e31 - 0.5f) / (0.5f + (((1f - _e34) * (0.5f - _e37)) / 0.5f))) * 0.5f) + 0.5f);
    let _e45 = skewX_1;
    let _e46 = skewY_1;
    return vec2<f32>(_e45, _e46);
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn transition(p_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var pr: f32;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;

    let _e25 = uniforms.progress;
    let _e28 = (*p_2)[0u];
    pr = step((1f - _e25), _e28);
    let _e31 = (*p_2)[0u];
    if (_e31 < 0.5f) {
        let _e33 = (*p_2);
        param_2 = _e33;
        let _e34 = getFromColor((&param_2));
        let _e35 = (*p_2);
        param_3 = _e35;
        let _e36 = skewLeft((&param_3));
        param_4 = _e36;
        let _e37 = getToColor((&param_4));
        let _e38 = addShade_u0028_();
        let _e40 = pr;
        return mix(_e34, (_e37 * _e38), vec4(_e40));
    } else {
        let _e43 = (*p_2);
        param_5 = _e43;
        let _e44 = skewRight((&param_5));
        param_6 = _e44;
        let _e45 = getFromColor((&param_6));
        let _e46 = addShade_u0028_();
        let _e48 = (*p_2);
        param_7 = _e48;
        let _e49 = getToColor((&param_7));
        let _e50 = pr;
        return mix((_e45 * _e46), _e49, vec4(_e50));
    }
}

fn main_1() {
    var param_8: vec2<f32>;

    let _e17 = _uv_1;
    param_8 = _e17;
    let _e18 = transition((&param_8));
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
