// Swirl — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Swirl.glsl
// Author: Sergey Kosarevsky
// License: MIT
// Description: Both images swirl around the center while crossfading
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

fn transition(UV: ptr<function, vec2<f32>>) -> vec4<f32> {
    var Radius: f32;
    var T: f32;
    var Dist: f32;
    var Percent: f32;
    var A: f32;
    var local: f32;
    var Theta: f32;
    var S: f32;
    var C: f32;
    var C0_: vec4<f32>;
    var param: vec2<f32>;
    var C1_: vec4<f32>;
    var param_1: vec2<f32>;

    Radius = 1f;
    let _e30 = uniforms.progress;
    T = _e30;
    let _e31 = (*UV);
    (*UV) = (_e31 - vec2<f32>(0.5f, 0.5f));
    let _e33 = (*UV);
    Dist = length(_e33);
    let _e35 = Dist;
    let _e36 = Radius;
    if (_e35 < _e36) {
        let _e38 = Radius;
        let _e39 = Dist;
        let _e41 = Radius;
        Percent = ((_e38 - _e39) / _e41);
        let _e43 = T;
        if (_e43 <= 0.5f) {
            let _e45 = T;
            local = mix(0f, 1f, (_e45 / 0.5f));
        } else {
            let _e48 = T;
            local = mix(1f, 0f, ((_e48 - 0.5f) / 0.5f));
        }
        let _e52 = local;
        A = _e52;
        let _e53 = Percent;
        let _e54 = Percent;
        let _e56 = A;
        Theta = ((((_e53 * _e54) * _e56) * 8f) * 3.14159f);
        let _e60 = Theta;
        S = sin(_e60);
        let _e62 = Theta;
        C = cos(_e62);
        let _e64 = (*UV);
        let _e65 = C;
        let _e66 = S;
        let _e70 = (*UV);
        let _e71 = S;
        let _e72 = C;
        (*UV) = vec2<f32>(dot(_e64, vec2<f32>(_e65, -(_e66))), dot(_e70, vec2<f32>(_e71, _e72)));
    }
    let _e76 = (*UV);
    (*UV) = (_e76 + vec2<f32>(0.5f, 0.5f));
    let _e78 = (*UV);
    param = _e78;
    let _e79 = getFromColor((&param));
    C0_ = _e79;
    let _e80 = (*UV);
    param_1 = _e80;
    let _e81 = getToColor((&param_1));
    C1_ = _e81;
    let _e82 = C0_;
    let _e83 = C1_;
    let _e84 = T;
    return mix(_e82, _e83, vec4(_e84));
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
