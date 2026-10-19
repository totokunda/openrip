// rotate_scale_fade — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/rotate_scale_fade.glsl
// Author: Fernando Kuteken
// License: MIT
// Description: The outgoing image spins and zooms while fading to the incoming one, over a background color
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    center: vec2<f32>,
    rotations: f32,
    scale: f32,
    backColor: vec4<f32>,
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
    let _e20 = (*uv)[0u];
    let _e22 = (*uv)[1u];
    let _e25 = textureSampleLevel(_to, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e20 = (*uv_1)[0u];
    let _e22 = (*uv_1)[1u];
    let _e25 = textureSampleLevel(_from, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var difference: vec2<f32>;
    var dir: vec2<f32>;
    var dist: f32;
    var angle: f32;
    var c: f32;
    var s: f32;
    var currentScale: f32;
    var rotatedDir: vec2<f32>;
    var rotatedUv: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var phi_144_: bool;
    var phi_151_: bool;
    var phi_158_: bool;

    let _e30 = (*uv_2);
    let _e32 = uniforms.center;
    difference = (_e30 - _e32);
    let _e34 = difference;
    dir = normalize(_e34);
    let _e36 = difference;
    dist = length(_e36);
    let _e39 = uniforms.rotations;
    let _e42 = uniforms.progress;
    angle = ((6.2831855f * _e39) * _e42);
    let _e44 = angle;
    c = cos(_e44);
    let _e46 = angle;
    s = sin(_e46);
    let _e49 = uniforms.scale;
    let _e51 = uniforms.progress;
    currentScale = mix(_e49, 1f, (2f * abs((_e51 - 0.5f))));
    let _e57 = dir[0u];
    let _e58 = c;
    let _e61 = dir[1u];
    let _e62 = s;
    let _e66 = dir[0u];
    let _e67 = s;
    let _e70 = dir[1u];
    let _e71 = c;
    rotatedDir = vec2<f32>(((_e57 * _e58) - (_e61 * _e62)), ((_e66 * _e67) + (_e70 * _e71)));
    let _e76 = uniforms.center;
    let _e77 = rotatedDir;
    let _e78 = dist;
    let _e80 = currentScale;
    rotatedUv = (_e76 + ((_e77 * _e78) / vec2(_e80)));
    let _e85 = rotatedUv[0u];
    let _e86 = (_e85 < 0f);
    phi_144_ = _e86;
    if !(_e86) {
        let _e89 = rotatedUv[0u];
        phi_144_ = (_e89 > 1f);
    }
    let _e92 = phi_144_;
    phi_151_ = _e92;
    if !(_e92) {
        let _e95 = rotatedUv[1u];
        phi_151_ = (_e95 < 0f);
    }
    let _e98 = phi_151_;
    phi_158_ = _e98;
    if !(_e98) {
        let _e101 = rotatedUv[1u];
        phi_158_ = (_e101 > 1f);
    }
    let _e104 = phi_158_;
    if _e104 {
        let _e106 = uniforms.backColor;
        return _e106;
    }
    let _e107 = rotatedUv;
    param = _e107;
    let _e108 = getFromColor((&param));
    let _e109 = rotatedUv;
    param_1 = _e109;
    let _e110 = getToColor((&param_1));
    let _e112 = uniforms.progress;
    return mix(_e108, _e110, vec4(_e112));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e19 = _uv_1;
    param_2 = _e19;
    let _e20 = transition((&param_2));
    _fragColor = _e20;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
