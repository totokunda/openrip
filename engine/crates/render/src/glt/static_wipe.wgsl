// static_wipe — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/static_wipe.glsl
// Author: Ben Lucas
// License: MIT
// Description: A wipe from top to bottom with a band of TV static at its edge
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    u_transitionUpToDown: i32,
    u_max_static_span: f32,
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

fn rnd(st: ptr<function, vec2<f32>>) -> f32 {
    let _e20 = (*st);
    return fract((sin(dot(_e20, vec2<f32>(10f, 70f))) * 12345.545f));
}

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
    var span: f32;
    var transitionEdge: f32;
    var local: f32;
    var mixRatio: f32;
    var transitionMix: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var noiseEnvelope: f32;
    var noise: vec4<f32>;
    var param_2: vec2<f32>;

    let _e31 = uniforms.u_max_static_span;
    let _e33 = uniforms.progress;
    span = (_e31 * pow(sin((3.1415927f * _e33)), 0.5f));
    let _e39 = uniforms.u_transitionUpToDown;
    if (_e39 != 0i) {
        let _e42 = (*uv_2)[1u];
        local = (1f - _e42);
    } else {
        let _e45 = (*uv_2)[1u];
        local = _e45;
    }
    let _e46 = local;
    transitionEdge = _e46;
    let _e48 = uniforms.progress;
    let _e49 = transitionEdge;
    mixRatio = (1f - step(_e48, _e49));
    let _e52 = (*uv_2);
    param = _e52;
    let _e53 = getFromColor((&param));
    let _e54 = (*uv_2);
    param_1 = _e54;
    let _e55 = getToColor((&param_1));
    let _e56 = mixRatio;
    transitionMix = mix(_e53, _e55, vec4(_e56));
    let _e60 = uniforms.progress;
    let _e61 = span;
    let _e64 = uniforms.progress;
    let _e65 = transitionEdge;
    let _e68 = uniforms.progress;
    let _e70 = uniforms.progress;
    let _e71 = span;
    let _e73 = transitionEdge;
    noiseEnvelope = (smoothstep((_e60 - _e61), _e64, _e65) * (1f - smoothstep(_e68, (_e70 + _e71), _e73)));
    let _e77 = (*uv_2);
    let _e79 = uniforms.progress;
    param_2 = (_e77 * (1f + _e79));
    let _e82 = rnd((&param_2));
    let _e83 = vec3(_e82);
    noise = vec4<f32>(_e83.x, _e83.y, _e83.z, 1f);
    let _e88 = transitionMix;
    let _e89 = noise;
    let _e90 = noiseEnvelope;
    return mix(_e88, _e89, vec4(_e90));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e20 = _uv_1;
    param_3 = _e20;
    let _e21 = transition((&param_3));
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
