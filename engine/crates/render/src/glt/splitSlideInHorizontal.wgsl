// splitSlideInHorizontal — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/splitSlideInHorizontal.glsl
// Author: OllyOllyOlly
// License: MIT
// Description: The incoming image slides in as two halves moving horizontally in opposite directions
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
    var toP: vec2<f32>;
    var local: vec2<f32>;
    var fromP: vec2<f32>;
    var param: vec2<f32>;
    var local_1: vec4<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e26 = uniforms.reverse;
    modifier = select(1f, -1f, (_e26 != 0i));
    let _e30 = (*uv_2)[1u];
    if (_e30 > 0.5f) {
        let _e33 = (*uv_2)[0u];
        let _e35 = uniforms.progress;
        let _e36 = modifier;
        let _e39 = modifier;
        let _e42 = (*uv_2)[1u];
        local = vec2<f32>(((_e33 - (_e35 * _e36)) + _e39), _e42);
    } else {
        let _e45 = (*uv_2)[0u];
        let _e47 = uniforms.progress;
        let _e48 = modifier;
        let _e51 = modifier;
        let _e54 = (*uv_2)[1u];
        local = vec2<f32>(((_e45 + (_e47 * _e48)) - _e51), _e54);
    }
    let _e56 = local;
    toP = _e56;
    let _e57 = (*uv_2);
    fromP = _e57;
    let _e58 = toP;
    param = _e58;
    let _e59 = inBounds((&param));
    if _e59 {
        let _e60 = toP;
        param_1 = _e60;
        let _e61 = getToColor((&param_1));
        local_1 = _e61;
    } else {
        let _e62 = fromP;
        param_2 = _e62;
        let _e63 = getFromColor((&param_2));
        local_1 = _e63;
    }
    let _e64 = local_1;
    return _e64;
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
