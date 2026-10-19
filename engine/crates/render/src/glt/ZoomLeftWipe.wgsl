// ZoomLeftWipe — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/ZoomLeftWipe.glsl
// Author: Handk
// License: MIT
// Description: Zooms into the outgoing image, then the incoming one wipes in from right to left
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    zoom_quickness: f32,
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
    let _e17 = (*amount);
    if (_e17 < 0.5f) {
        let _e19 = (*uv_2);
        let _e22 = (*amount);
        return (vec2(0.5f) + ((_e19 - vec2(0.5f)) * (1f - _e22)));
    } else {
        let _e27 = (*uv_2);
        let _e30 = (*amount);
        return (vec2(0.5f) + ((_e27 - vec2(0.5f)) * _e30));
    }
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var nQuick: f32;
    var c: vec4<f32>;
    var param: vec2<f32>;
    var param_1: f32;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var p: vec2<f32>;
    var d: vec4<f32>;
    var param_4: vec2<f32>;
    var e: vec4<f32>;
    var param_5: vec2<f32>;
    var f: vec4<f32>;

    let _e29 = uniforms.zoom_quickness;
    nQuick = clamp(_e29, 0f, 0.5f);
    let _e32 = uniforms.progress;
    if (_e32 < 0.5f) {
        let _e34 = nQuick;
        let _e36 = uniforms.progress;
        let _e38 = (*uv_3);
        param = _e38;
        param_1 = smoothstep(0f, _e34, _e36);
        let _e39 = zoom((&param), (&param_1));
        param_2 = _e39;
        let _e40 = getFromColor((&param_2));
        let _e41 = (*uv_3);
        param_3 = _e41;
        let _e42 = getToColor((&param_3));
        let _e44 = uniforms.progress;
        c = mix(_e40, _e42, vec4(step(0.5f, _e44)));
        let _e48 = c;
        return _e48;
    } else {
        let _e49 = (*uv_3);
        p = (_e49 / vec2<f32>(1f, 1f));
        let _e51 = p;
        param_4 = _e51;
        let _e52 = getFromColor((&param_4));
        d = _e52;
        let _e53 = p;
        param_5 = _e53;
        let _e54 = getToColor((&param_5));
        e = _e54;
        let _e55 = d;
        let _e56 = e;
        let _e58 = p[0u];
        let _e61 = uniforms.progress;
        f = mix(_e55, _e56, vec4(step((1f - _e58), ((_e61 - 0.5f) * 2f))));
        let _e67 = f;
        return _e67;
    }
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
