// DirectionalScaled — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/DirectionalScaled.glsl
// Author: Thibaut Foussard
// License: MIT
// Description: Like Directional, with both images scaled down while they slide
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    direction: vec2<f32>,
    scale: f32,
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
    let _e19 = (*uv)[0u];
    let _e21 = (*uv)[1u];
    let _e24 = textureSampleLevel(_from, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e19 = (*uv_1)[0u];
    let _e21 = (*uv_1)[1u];
    let _e24 = textureSampleLevel(_to, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn parabola(x: ptr<function, f32>) -> f32 {
    var y: f32;

    let _e19 = (*x);
    y = pow(sin((_e19 * 3.1415927f)), 1f);
    let _e23 = y;
    return _e23;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var easedProgress: f32;
    var p: vec2<f32>;
    var f: vec2<f32>;
    var s: f32;
    var param: f32;
    var mixer: f32;
    var col: vec4<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var border: f32;

    let _e29 = uniforms.progress;
    easedProgress = pow(sin(((_e29 * 3.1415927f) / 2f)), 3f);
    let _e34 = (*uv_2);
    let _e35 = easedProgress;
    let _e37 = uniforms.direction;
    p = (_e34 + (sign(_e37) * _e35));
    let _e41 = p;
    f = fract(_e41);
    let _e44 = uniforms.scale;
    let _e48 = uniforms.progress;
    param = _e48;
    let _e49 = parabola((&param));
    s = (1f - ((1f - (1f / _e44)) * _e49));
    let _e52 = f;
    let _e55 = s;
    f = (((_e52 - vec2(0.5f)) * _e55) + vec2(0.5f));
    let _e60 = p[1u];
    let _e63 = p[1u];
    let _e67 = p[0u];
    let _e71 = p[0u];
    mixer = (((step(0f, _e60) * step(_e63, 1f)) * step(0f, _e67)) * step(_e71, 1f));
    let _e74 = f;
    param_1 = _e74;
    let _e75 = getToColor((&param_1));
    let _e76 = f;
    param_2 = _e76;
    let _e77 = getFromColor((&param_2));
    let _e78 = mixer;
    col = mix(_e75, _e77, vec4(_e78));
    let _e82 = f[0u];
    let _e85 = f[0u];
    let _e90 = f[1u];
    let _e94 = f[1u];
    border = (((step(0f, _e82) * step(0f, (1f - _e85))) * step(0f, _e90)) * step(0f, (1f - _e94)));
    let _e98 = border;
    let _e99 = col;
    col = (_e99 * _e98);
    let _e101 = col;
    return _e101;
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e18 = _uv_1;
    param_3 = _e18;
    let _e19 = transition((&param_3));
    _fragColor = _e19;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
