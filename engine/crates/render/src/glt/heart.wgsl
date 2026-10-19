// heart — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/heart.glsl
// Author: gre
// License: MIT
// Description: A heart shape grows from the center to reveal the incoming image
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

fn inHeart(p: ptr<function, vec2<f32>>, center: ptr<function, vec2<f32>>, size: ptr<function, f32>) -> f32 {
    var o: vec2<f32>;
    var a: f32;

    let _e21 = (*size);
    if (_e21 == 0f) {
        return 0f;
    }
    let _e23 = (*p);
    let _e24 = (*center);
    let _e26 = (*size);
    o = ((_e23 - _e24) / vec2((1.6f * _e26)));
    let _e31 = o[0u];
    let _e33 = o[0u];
    let _e36 = o[1u];
    let _e38 = o[1u];
    a = (((_e31 * _e33) + (_e36 * _e38)) - 0.3f);
    let _e42 = a;
    let _e43 = a;
    let _e45 = a;
    let _e48 = o[0u];
    let _e50 = o[0u];
    let _e53 = o[1u];
    let _e56 = o[1u];
    let _e59 = o[1u];
    return step(((_e42 * _e43) * _e45), ((((_e48 * _e50) * _e53) * _e56) * _e59));
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: f32;

    let _e22 = (*uv_2);
    param = _e22;
    let _e23 = getFromColor((&param));
    let _e24 = (*uv_2);
    param_1 = _e24;
    let _e25 = getToColor((&param_1));
    let _e26 = (*uv_2);
    param_2 = _e26;
    param_3 = vec2<f32>(0.5f, 0.4f);
    let _e28 = uniforms.progress;
    param_4 = _e28;
    let _e29 = inHeart((&param_2), (&param_3), (&param_4));
    return mix(_e23, _e25, vec4(_e29));
}

fn main_1() {
    var param_5: vec2<f32>;

    let _e17 = _uv_1;
    param_5 = _e17;
    let _e18 = transition((&param_5));
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
