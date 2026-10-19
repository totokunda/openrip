// dissolve — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/dissolve.glsl
// Author: hjm1fb
// License: MIT
// Description: The incoming image spreads over the outgoing one with a hot, glowing edge
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    uLineWidth: f32,
    uSpreadClr: vec3<f32>,
    uHotClr: vec3<f32>,
    uPow: f32,
    uIntensity: f32,
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
    let _e26 = (*uv)[0u];
    let _e28 = (*uv)[1u];
    let _e31 = textureSampleLevel(_to, _sampler, vec2<f32>(_e26, (1f - _e28)), 0f);
    return _e31;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e26 = (*uv_1)[0u];
    let _e28 = (*uv_1)[1u];
    let _e31 = textureSampleLevel(_from, _sampler, vec2<f32>(_e26, (1f - _e28)), 0f);
    return _e31;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var from_: vec4<f32>;
    var param: vec2<f32>;
    var to: vec4<f32>;
    var param_1: vec2<f32>;
    var burn: f32;
    var show: f32;
    var outColor: vec4<f32>;
    var factor: f32;
    var burnColor: vec3<f32>;
    var finalRGB: vec3<f32>;

    let _e35 = (*uv_2);
    param = _e35;
    let _e36 = getFromColor((&param));
    from_ = _e36;
    let _e37 = (*uv_2);
    param_1 = _e37;
    let _e38 = getToColor((&param_1));
    to = _e38;
    let _e40 = from_[0u];
    let _e43 = from_[1u];
    let _e47 = from_[2u];
    burn = (0.5f + (0.5f * (((0.299f * _e40) + (0.587f * _e43)) + (0.114f * _e47))));
    let _e52 = burn;
    let _e54 = uniforms.progress;
    show = (_e52 - _e54);
    let _e56 = show;
    if (_e56 < 0.001f) {
        let _e58 = to;
        outColor = _e58;
    } else {
        let _e60 = uniforms.uLineWidth;
        let _e61 = show;
        factor = (1f - smoothstep(0f, _e60, _e61));
        let _e65 = uniforms.uSpreadClr;
        let _e67 = uniforms.uHotClr;
        let _e68 = factor;
        burnColor = mix(_e65, _e67, vec3(_e68));
        let _e71 = burnColor;
        let _e73 = uniforms.uPow;
        let _e77 = uniforms.uIntensity;
        burnColor = (pow(_e71, vec3(_e73)) * _e77);
        let _e79 = from_;
        let _e81 = burnColor;
        let _e82 = factor;
        let _e84 = uniforms.progress;
        finalRGB = mix(_e79.xyz, _e81, vec3((_e82 * step(0.0001f, _e84))));
        let _e89 = finalRGB;
        let _e91 = from_[3u];
        let _e92 = (_e89 * _e91);
        let _e94 = from_[3u];
        outColor = vec4<f32>(_e92.x, _e92.y, _e92.z, _e94);
    }
    let _e99 = outColor;
    return _e99;
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e25 = _uv_1;
    param_2 = _e25;
    let _e26 = transition((&param_2));
    _fragColor = _e26;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
