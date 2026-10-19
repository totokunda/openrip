// morph — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/morph.glsl
// Author: paniq
// License: MIT
// Description: A crossfade in which each image is displaced by the other's colors, like a morph
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    strength: f32,
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var ca: vec4<f32>;
    var param: vec2<f32>;
    var cb: vec4<f32>;
    var param_1: vec2<f32>;
    var oa: vec2<f32>;
    var ob: vec2<f32>;
    var oc: vec2<f32>;
    var w0_: f32;
    var w1_: f32;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    let _e27 = (*p);
    param = _e27;
    let _e28 = getFromColor((&param));
    ca = _e28;
    let _e29 = (*p);
    param_1 = _e29;
    let _e30 = getToColor((&param_1));
    cb = _e30;
    let _e31 = ca;
    let _e34 = ca[2u];
    oa = ((((_e31.xy + vec2(_e34)) * 0.5f) * 2f) - vec2(1f));
    let _e41 = cb;
    let _e44 = cb[2u];
    ob = ((((_e41.xy + vec2(_e44)) * 0.5f) * 2f) - vec2(1f));
    let _e51 = oa;
    let _e52 = ob;
    let _e56 = uniforms.strength;
    oc = (mix(_e51, _e52, vec2(0.5f)) * _e56);
    let _e59 = uniforms.progress;
    w0_ = _e59;
    let _e60 = w0_;
    w1_ = (1f - _e60);
    let _e62 = (*p);
    let _e63 = oc;
    let _e64 = w0_;
    param_2 = (_e62 + (_e63 * _e64));
    let _e67 = getFromColor((&param_2));
    let _e68 = (*p);
    let _e69 = oc;
    let _e70 = w1_;
    param_3 = (_e68 - (_e69 * _e70));
    let _e73 = getToColor((&param_3));
    let _e75 = uniforms.progress;
    return mix(_e67, _e73, vec4(_e75));
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e16 = _uv_1;
    param_4 = _e16;
    let _e17 = transition((&param_4));
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
