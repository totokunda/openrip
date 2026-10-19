// fadecolor — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/fadecolor.glsl
// Author: gre
// License: MIT
// Description: A fade through a solid color, black by default
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    color: vec3<f32>,
    colorPhase: f32,
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
    let _e15 = (*uv)[0u];
    let _e17 = (*uv)[1u];
    let _e20 = textureSampleLevel(_to, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e15 = (*uv_1)[0u];
    let _e17 = (*uv_1)[1u];
    let _e20 = textureSampleLevel(_from, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e17 = uniforms.color;
    let _e22 = (*uv_2);
    param = _e22;
    let _e23 = getFromColor((&param));
    let _e25 = uniforms.colorPhase;
    let _e28 = uniforms.progress;
    let _e33 = uniforms.color;
    let _e38 = (*uv_2);
    param_1 = _e38;
    let _e39 = getToColor((&param_1));
    let _e41 = uniforms.colorPhase;
    let _e43 = uniforms.progress;
    let _e48 = uniforms.progress;
    return mix(mix(vec4<f32>(_e17.x, _e17.y, _e17.z, 1f), _e23, vec4(smoothstep((1f - _e25), 0f, _e28))), mix(vec4<f32>(_e33.x, _e33.y, _e33.z, 1f), _e39, vec4(smoothstep(_e41, 1f, _e43))), vec4(_e48));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e14 = _uv_1;
    param_2 = _e14;
    let _e15 = transition((&param_2));
    _fragColor = _e15;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
