// PolkaDotsCurtain — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/PolkaDotsCurtain.glsl
// Author: bobylito
// License: MIT
// Description: The incoming image appears through growing polka dots
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    dots: f32,
    center: vec2<f32>,
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

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var nextImage: bool;
    var local: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e21 = (*uv_2);
    let _e23 = uniforms.dots;
    let _e28 = uniforms.progress;
    let _e29 = (*uv_2);
    let _e31 = uniforms.center;
    nextImage = (distance(fract((_e21 * _e23)), vec2<f32>(0.5f, 0.5f)) < (_e28 / distance(_e29, _e31)));
    let _e35 = nextImage;
    if _e35 {
        let _e36 = (*uv_2);
        param = _e36;
        let _e37 = getToColor((&param));
        local = _e37;
    } else {
        let _e38 = (*uv_2);
        param_1 = _e38;
        let _e39 = getFromColor((&param_1));
        local = _e39;
    }
    let _e40 = local;
    return _e40;
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e17 = _uv_1;
    param_2 = _e17;
    let _e18 = transition((&param_2));
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
