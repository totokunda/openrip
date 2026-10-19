// CrossZoom — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/CrossZoom.glsl
// Author: rectalogic
// License: MIT
// Description: A crossfade through a strong zoom blur
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    strength: f32,
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
    let _e28 = (*uv)[0u];
    let _e30 = (*uv)[1u];
    let _e33 = textureSampleLevel(_to, _sampler, vec2<f32>(_e28, (1f - _e30)), 0f);
    return _e33;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e28 = (*uv_1)[0u];
    let _e30 = (*uv_1)[1u];
    let _e33 = textureSampleLevel(_from, _sampler, vec2<f32>(_e28, (1f - _e30)), 0f);
    return _e33;
}

fn crossFade(uv_2: ptr<function, vec2<f32>>, dissolve: ptr<function, f32>) -> vec4<f32> {
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e30 = (*uv_2);
    param = _e30;
    let _e31 = getFromColor((&param));
    let _e32 = (*uv_2);
    param_1 = _e32;
    let _e33 = getToColor((&param_1));
    let _e34 = (*dissolve);
    return mix(_e31, _e33, vec4(_e34));
}

fn rand(co: ptr<function, vec2<f32>>) -> f32 {
    let _e27 = (*co);
    return fract((sin(dot(_e27, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn Sinusoidal_easeInOut(begin: ptr<function, f32>, change: ptr<function, f32>, duration: ptr<function, f32>, time: ptr<function, f32>) -> f32 {
    let _e30 = (*change);
    let _e33 = (*time);
    let _e35 = (*duration);
    let _e40 = (*begin);
    return (((-(_e30) / 2f) * (cos(((3.1415927f * _e33) / _e35)) - 1f)) + _e40);
}

fn Exponential_easeInOut(begin_1: ptr<function, f32>, change_1: ptr<function, f32>, duration_1: ptr<function, f32>, time_1: ptr<function, f32>) -> f32 {
    let _e30 = (*time_1);
    if (_e30 == 0f) {
        let _e32 = (*begin_1);
        return _e32;
    } else {
        let _e33 = (*time_1);
        let _e34 = (*duration_1);
        if (_e33 == _e34) {
            let _e36 = (*begin_1);
            let _e37 = (*change_1);
            return (_e36 + _e37);
        }
    }
    let _e39 = (*time_1);
    let _e40 = (*duration_1);
    (*time_1) = (_e39 / (_e40 / 2f));
    let _e43 = (*time_1);
    if (_e43 < 1f) {
        let _e45 = (*change_1);
        let _e47 = (*time_1);
        let _e52 = (*begin_1);
        return (((_e45 / 2f) * pow(2f, (10f * (_e47 - 1f)))) + _e52);
    }
    let _e54 = (*change_1);
    let _e56 = (*time_1);
    let _e63 = (*begin_1);
    return (((_e54 / 2f) * (-(pow(2f, (-10f * (_e56 - 1f)))) + 2f)) + _e63);
}

fn Linear_ease(begin_2: ptr<function, f32>, change_2: ptr<function, f32>, duration_2: ptr<function, f32>, time_2: ptr<function, f32>) -> f32 {
    let _e30 = (*change_2);
    let _e31 = (*time_2);
    let _e33 = (*duration_2);
    let _e35 = (*begin_2);
    return (((_e30 * _e31) / _e33) + _e35);
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var texCoord: vec2<f32>;
    var center: vec2<f32>;
    var param_2: f32;
    var param_3: f32;
    var param_4: f32;
    var param_5: f32;
    var dissolve_1: f32;
    var param_6: f32;
    var param_7: f32;
    var param_8: f32;
    var param_9: f32;
    var strength: f32;
    var param_10: f32;
    var param_11: f32;
    var param_12: f32;
    var param_13: f32;
    var color: vec4<f32>;
    var total: f32;
    var toCenter: vec2<f32>;
    var offset: f32;
    var param_14: vec2<f32>;
    var t: f32;
    var percent: f32;
    var weight: f32;
    var param_15: vec2<f32>;
    var param_16: f32;

    let _e53 = (*uv_3);
    texCoord = (_e53 / vec2<f32>(1f, 1f));
    param_2 = 0.25f;
    param_3 = 0.5f;
    param_4 = 1f;
    let _e56 = uniforms.progress;
    param_5 = _e56;
    let _e57 = Linear_ease((&param_2), (&param_3), (&param_4), (&param_5));
    center = vec2<f32>(_e57, 0.5f);
    param_6 = 0f;
    param_7 = 1f;
    param_8 = 1f;
    let _e60 = uniforms.progress;
    param_9 = _e60;
    let _e61 = Exponential_easeInOut((&param_6), (&param_7), (&param_8), (&param_9));
    dissolve_1 = _e61;
    param_10 = 0f;
    let _e63 = uniforms.strength;
    param_11 = _e63;
    param_12 = 0.5f;
    let _e65 = uniforms.progress;
    param_13 = _e65;
    let _e66 = Sinusoidal_easeInOut((&param_10), (&param_11), (&param_12), (&param_13));
    strength = _e66;
    color = vec4<f32>(0f, 0f, 0f, 0f);
    total = 0f;
    let _e67 = center;
    let _e68 = texCoord;
    toCenter = (_e67 - _e68);
    let _e70 = (*uv_3);
    param_14 = _e70;
    let _e71 = rand((&param_14));
    offset = _e71;
    t = 0f;
    loop {
        let _e72 = t;
        if (_e72 <= 40f) {
            let _e74 = t;
            let _e75 = offset;
            percent = ((_e74 + _e75) / 40f);
            let _e78 = percent;
            let _e79 = percent;
            let _e80 = percent;
            weight = (4f * (_e78 - (_e79 * _e80)));
            let _e84 = texCoord;
            let _e85 = toCenter;
            let _e86 = percent;
            let _e88 = strength;
            param_15 = (_e84 + ((_e85 * _e86) * _e88));
            let _e91 = dissolve_1;
            param_16 = _e91;
            let _e92 = crossFade((&param_15), (&param_16));
            let _e93 = weight;
            let _e95 = color;
            color = (_e95 + (_e92 * _e93));
            let _e97 = weight;
            let _e98 = total;
            total = (_e98 + _e97);
            continue;
        } else {
            break;
        }
        continuing {
            let _e100 = t;
            t = (_e100 + 1f);
        }
    }
    let _e102 = color;
    let _e103 = total;
    return (_e102 / vec4(_e103));
}

fn main_1() {
    var param_17: vec2<f32>;

    let _e27 = _uv_1;
    param_17 = _e27;
    let _e28 = transition((&param_17));
    _fragColor = _e28;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
