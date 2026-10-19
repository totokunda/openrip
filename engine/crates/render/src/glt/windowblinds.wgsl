// windowblinds — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/windowblinds.glsl
// Author: Fabien Benetou
// License: MIT
// Description: A crossfade through horizontal window blinds
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
    var t: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e20 = uniforms.progress;
    t = _e20;
    let _e22 = (*uv_2)[1u];
    let _e25 = uniforms.progress;
    let _e27 = floor(((_e22 * 100f) * _e25));
    if ((_e27 - (floor((_e27 / 2f)) * 2f)) == 0f) {
        let _e33 = t;
        t = (_e33 * 1.5f);
    }
    let _e35 = (*uv_2);
    param = _e35;
    let _e36 = getFromColor((&param));
    let _e37 = (*uv_2);
    param_1 = _e37;
    let _e38 = getToColor((&param_1));
    let _e39 = t;
    let _e41 = uniforms.progress;
    let _e43 = uniforms.progress;
    return mix(_e36, _e38, vec4(mix(_e39, _e41, smoothstep(0.8f, 1f, _e43))));
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
