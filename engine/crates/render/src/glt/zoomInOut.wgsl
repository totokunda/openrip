// zoomInOut — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/zoomInOut.glsl
// Author: OllyOllyOlly
// License: MIT
// Description: Zooms into the outgoing image until it blurs into a flat color, then out to the incoming one
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

fn zoom(uv_2: ptr<function, vec2<f32>>, amount: ptr<function, f32>) -> vec2<f32> {
    let _e17 = (*uv_2);
    let _e20 = (*amount);
    return (vec2(0.5f) + ((_e17 - vec2(0.5f)) * (1f - _e20)));
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var zoomFrom: f32;
    var zoomTo: f32;
    var crossfade: f32;
    var param: vec2<f32>;
    var param_1: f32;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: f32;
    var param_5: vec2<f32>;

    let _e26 = uniforms.progress;
    zoomFrom = smoothstep(0f, 1f, (_e26 * 2f));
    let _e30 = uniforms.progress;
    zoomTo = smoothstep(0f, 1f, ((1f - _e30) * 2f));
    let _e35 = uniforms.progress;
    crossfade = smoothstep(0.4f, 0.6f, _e35);
    let _e37 = (*uv_3);
    param = _e37;
    let _e38 = zoomFrom;
    param_1 = _e38;
    let _e39 = zoom((&param), (&param_1));
    param_2 = _e39;
    let _e40 = getFromColor((&param_2));
    let _e41 = (*uv_3);
    param_3 = _e41;
    let _e42 = zoomTo;
    param_4 = _e42;
    let _e43 = zoom((&param_3), (&param_4));
    param_5 = _e43;
    let _e44 = getToColor((&param_5));
    let _e45 = crossfade;
    return mix(_e40, _e44, vec4(_e45));
}

fn main_1() {
    var param_6: vec2<f32>;

    let _e16 = _uv_1;
    param_6 = _e16;
    let _e17 = transition((&param_6));
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
