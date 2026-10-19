// ButterflyWaveScrawler — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/ButterflyWaveScrawler.glsl
// Author: mandubian
// License: MIT
// Description: Wavy, color-separated ripples scramble the outgoing image into the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    amplitude: f32,
    waves: f32,
    colorSeparation: f32,
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

fn compute(p: ptr<function, vec2<f32>>, progress: ptr<function, f32>, center: ptr<function, vec2<f32>>) -> f32 {
    var o: vec2<f32>;
    var h: vec2<f32>;
    var theta: f32;
    var s: f32;
    var s2_: f32;

    let _e31 = (*p);
    let _e32 = (*progress);
    let _e34 = uniforms.amplitude;
    let _e38 = (*center);
    o = ((_e31 * sin((_e32 * _e34))) - _e38);
    h = vec2<f32>(1f, 0f);
    let _e40 = o;
    let _e41 = h;
    let _e45 = uniforms.waves;
    theta = (acos(dot(_e40, _e41)) * _e45);
    let _e47 = theta;
    s = sin((((2f * _e47) - 3.1415927f) / 24f));
    let _e52 = s;
    let _e53 = s;
    s2_ = (_e52 * _e53);
    let _e55 = theta;
    let _e58 = theta;
    let _e63 = s2_;
    let _e64 = s2_;
    let _e66 = s;
    return (((exp(cos(_e55)) - (2f * cos((4f * _e58)))) + ((_e63 * _e64) * _e66)) / 10f);
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e25 = (*uv)[0u];
    let _e27 = (*uv)[1u];
    let _e30 = textureSampleLevel(_to, _sampler, vec2<f32>(_e25, (1f - _e27)), 0f);
    return _e30;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e25 = (*uv_1)[0u];
    let _e27 = (*uv_1)[1u];
    let _e30 = textureSampleLevel(_from, _sampler, vec2<f32>(_e25, (1f - _e27)), 0f);
    return _e30;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var p_1: vec2<f32>;
    var inv: f32;
    var disp: f32;
    var param_2: vec2<f32>;
    var param_3: f32;
    var param_4: vec2<f32>;
    var texTo: vec4<f32>;
    var param_5: vec2<f32>;
    var texFrom: vec4<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;

    let _e39 = uniforms.progress;
    if (_e39 <= 0f) {
        let _e41 = (*uv_2);
        param = _e41;
        let _e42 = getFromColor((&param));
        return _e42;
    }
    let _e44 = uniforms.progress;
    if (_e44 >= 1f) {
        let _e46 = (*uv_2);
        param_1 = _e46;
        let _e47 = getToColor((&param_1));
        return _e47;
    }
    let _e48 = (*uv_2);
    p_1 = _e48;
    let _e50 = uniforms.progress;
    inv = (1f - _e50);
    let _e52 = p_1;
    param_2 = _e52;
    let _e54 = uniforms.progress;
    param_3 = _e54;
    param_4 = vec2<f32>(0.5f, 0.5f);
    let _e55 = compute((&param_2), (&param_3), (&param_4));
    disp = _e55;
    let _e56 = p_1;
    let _e57 = inv;
    let _e58 = disp;
    param_5 = (_e56 + vec2((_e57 * _e58)));
    let _e62 = getToColor((&param_5));
    texTo = _e62;
    let _e63 = p_1;
    let _e65 = uniforms.progress;
    let _e66 = disp;
    let _e69 = uniforms.colorSeparation;
    param_6 = (_e63 + vec2(((_e65 * _e66) * (1f - _e69))));
    let _e74 = getFromColor((&param_6));
    let _e76 = p_1;
    let _e78 = uniforms.progress;
    let _e79 = disp;
    param_7 = (_e76 + vec2((_e78 * _e79)));
    let _e83 = getFromColor((&param_7));
    let _e85 = p_1;
    let _e87 = uniforms.progress;
    let _e88 = disp;
    let _e91 = uniforms.colorSeparation;
    param_8 = (_e85 + vec2(((_e87 * _e88) * (1f + _e91))));
    let _e96 = getFromColor((&param_8));
    texFrom = vec4<f32>(_e74.x, _e83.y, _e96.z, 1f);
    let _e99 = texTo;
    let _e101 = uniforms.progress;
    let _e103 = texFrom;
    let _e104 = inv;
    return ((_e99 * _e101) + (_e103 * _e104));
}

fn main_1() {
    var param_9: vec2<f32>;

    let _e24 = _uv_1;
    param_9 = _e24;
    let _e25 = transition((&param_9));
    _fragColor = _e25;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
