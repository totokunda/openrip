// DreamyZoom — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/DreamyZoom.glsl
// Author: Zeh Fernando
// License: MIT
// Description: Zooms and rotates into a bright flash, then out to the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    rotation: f32,
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

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e21 = (*uv)[0u];
    let _e23 = (*uv)[1u];
    let _e26 = textureSampleLevel(_to, _sampler, vec2<f32>(_e21, (1f - _e23)), 0f);
    return _e26;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e21 = (*uv_1)[0u];
    let _e23 = (*uv_1)[1u];
    let _e26 = textureSampleLevel(_from, _sampler, vec2<f32>(_e21, (1f - _e23)), 0f);
    return _e26;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var phase: f32;
    var local: f32;
    var angleOffset: f32;
    var local_1: f32;
    var newScale: f32;
    var local_2: f32;
    var center: vec2<f32>;
    var assumedCenter: vec2<f32>;
    var p: vec2<f32>;
    var angle: f32;
    var dist: f32;
    var c: vec4<f32>;
    var local_3: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var local_4: f32;

    let _e37 = uniforms.progress;
    if (_e37 < 0.5f) {
        let _e40 = uniforms.progress;
        local = (_e40 * 2f);
    } else {
        let _e43 = uniforms.progress;
        local = ((_e43 - 0.5f) * 2f);
    }
    let _e46 = local;
    phase = _e46;
    let _e48 = uniforms.progress;
    if (_e48 < 0.5f) {
        let _e51 = uniforms.rotation;
        let _e53 = phase;
        local_1 = mix(0f, (_e51 * 0.03926991f), _e53);
    } else {
        let _e56 = uniforms.rotation;
        let _e59 = phase;
        local_1 = mix((-(_e56) * 0.03926991f), 0f, _e59);
    }
    let _e61 = local_1;
    angleOffset = _e61;
    let _e63 = uniforms.progress;
    if (_e63 < 0.5f) {
        let _e66 = uniforms.scale;
        let _e67 = phase;
        local_2 = mix(1f, _e66, _e67);
    } else {
        let _e70 = uniforms.scale;
        let _e71 = phase;
        local_2 = mix(_e70, 1f, _e71);
    }
    let _e73 = local_2;
    newScale = _e73;
    center = vec2<f32>(0f, 0f);
    assumedCenter = vec2<f32>(0.5f, 0.5f);
    let _e74 = (*uv_2);
    let _e76 = newScale;
    let _e80 = uniforms.ratio;
    p = (((_e74 - vec2<f32>(0.5f, 0.5f)) / vec2(_e76)) * vec2<f32>(_e80, 1f));
    let _e84 = p[1u];
    let _e86 = p[0u];
    let _e88 = angleOffset;
    angle = (atan2(_e84, _e86) + _e88);
    let _e90 = center;
    let _e91 = p;
    dist = distance(_e90, _e91);
    let _e93 = angle;
    let _e95 = dist;
    let _e98 = uniforms.ratio;
    p[0u] = (((cos(_e93) * _e95) / _e98) + 0.5f);
    let _e102 = angle;
    let _e104 = dist;
    p[1u] = ((sin(_e102) * _e104) + 0.5f);
    let _e109 = uniforms.progress;
    if (_e109 < 0.5f) {
        let _e111 = p;
        param = _e111;
        let _e112 = getFromColor((&param));
        local_3 = _e112;
    } else {
        let _e113 = p;
        param_1 = _e113;
        let _e114 = getToColor((&param_1));
        local_3 = _e114;
    }
    let _e115 = local_3;
    c = _e115;
    let _e116 = c;
    let _e118 = uniforms.progress;
    if (_e118 < 0.5f) {
        let _e120 = phase;
        local_4 = mix(0f, 1f, _e120);
    } else {
        let _e122 = phase;
        local_4 = mix(1f, 0f, _e122);
    }
    let _e124 = local_4;
    return (_e116 + vec4(_e124));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e20 = _uv_1;
    param_2 = _e20;
    let _e21 = transition((&param_2));
    _fragColor = _e21;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
