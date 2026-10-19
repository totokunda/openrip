// RotateScaleVanish — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/RotateScaleVanish.glsl
// Author: Mark Craig
// License: MIT
// Description: The outgoing image spins and shrinks away over the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    FadeInSecond: i32,
    ReverseEffect: i32,
    ReverseRotation: i32,
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
    let _e23 = (*uv)[0u];
    let _e25 = (*uv)[1u];
    let _e28 = textureSampleLevel(_to, _sampler, vec2<f32>(_e23, (1f - _e25)), 0f);
    return _e28;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e23 = (*uv_1)[0u];
    let _e25 = (*uv_1)[1u];
    let _e28 = textureSampleLevel(_from, _sampler, vec2<f32>(_e23, (1f - _e25)), 0f);
    return _e28;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var iResolution: vec2<f32>;
    var t: f32;
    var local: f32;
    var theta: f32;
    var local_1: f32;
    var c1_: f32;
    var s1_: f32;
    var rad: f32;
    var xc1_: f32;
    var yc1_: f32;
    var xc2_: f32;
    var yc2_: f32;
    var uv2_: vec2<f32>;
    var ColorTo: vec4<f32>;
    var local_2: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var col3_: vec4<f32>;
    var local_3: vec4<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var phi_187_: bool;
    var phi_193_: bool;
    var phi_201_: bool;

    let _e44 = uniforms.ratio;
    iResolution = vec2<f32>(_e44, 1f);
    let _e47 = uniforms.ReverseEffect;
    if (_e47 != 0i) {
        let _e50 = uniforms.progress;
        local = (1f - _e50);
    } else {
        let _e53 = uniforms.progress;
        local = _e53;
    }
    let _e54 = local;
    t = _e54;
    let _e56 = uniforms.ReverseRotation;
    if (_e56 != 0i) {
        let _e58 = t;
        local_1 = (6.2831855f * _e58);
    } else {
        let _e60 = t;
        local_1 = (-6.2831855f * _e60);
    }
    let _e62 = local_1;
    theta = _e62;
    let _e63 = theta;
    c1_ = cos(_e63);
    let _e65 = theta;
    s1_ = sin(_e65);
    let _e67 = t;
    rad = max(0.00001f, (1f - _e67));
    let _e71 = (*uv_2)[0u];
    let _e74 = iResolution[0u];
    xc1_ = ((_e71 - 0.5f) * _e74);
    let _e77 = (*uv_2)[1u];
    let _e80 = iResolution[1u];
    yc1_ = ((_e77 - 0.5f) * _e80);
    let _e82 = xc1_;
    let _e83 = c1_;
    let _e85 = yc1_;
    let _e86 = s1_;
    let _e89 = rad;
    xc2_ = (((_e82 * _e83) - (_e85 * _e86)) / _e89);
    let _e91 = xc1_;
    let _e92 = s1_;
    let _e94 = yc1_;
    let _e95 = c1_;
    let _e98 = rad;
    yc2_ = (((_e91 * _e92) + (_e94 * _e95)) / _e98);
    let _e100 = xc2_;
    let _e102 = iResolution[0u];
    let _e105 = yc2_;
    let _e107 = iResolution[1u];
    uv2_ = vec2<f32>((_e100 + (_e102 / 2f)), (_e105 + (_e107 / 2f)));
    let _e112 = uniforms.ReverseEffect;
    if (_e112 != 0i) {
        let _e114 = (*uv_2);
        param = _e114;
        let _e115 = getFromColor((&param));
        local_2 = _e115;
    } else {
        let _e116 = (*uv_2);
        param_1 = _e116;
        let _e117 = getToColor((&param_1));
        local_2 = _e117;
    }
    let _e118 = local_2;
    ColorTo = _e118;
    let _e120 = uv2_[0u];
    let _e121 = (_e120 >= 0f);
    phi_187_ = _e121;
    if _e121 {
        let _e123 = uv2_[0u];
        let _e125 = iResolution[0u];
        phi_187_ = (_e123 <= _e125);
    }
    let _e128 = phi_187_;
    phi_193_ = _e128;
    if _e128 {
        let _e130 = uv2_[1u];
        phi_193_ = (_e130 >= 0f);
    }
    let _e133 = phi_193_;
    phi_201_ = _e133;
    if _e133 {
        let _e135 = uv2_[1u];
        let _e137 = iResolution[1u];
        phi_201_ = (_e135 <= _e137);
    }
    let _e140 = phi_201_;
    if _e140 {
        let _e141 = iResolution;
        let _e142 = uv2_;
        uv2_ = (_e142 / _e141);
        let _e145 = uniforms.ReverseEffect;
        if (_e145 != 0i) {
            let _e147 = uv2_;
            param_2 = _e147;
            let _e148 = getToColor((&param_2));
            local_3 = _e148;
        } else {
            let _e149 = uv2_;
            param_3 = _e149;
            let _e150 = getFromColor((&param_3));
            local_3 = _e150;
        }
        let _e151 = local_3;
        col3_ = _e151;
    } else {
        let _e153 = uniforms.FadeInSecond;
        let _e155 = ColorTo;
        col3_ = select(_e155, vec4<f32>(0f, 0f, 0f, 1f), vec4((_e153 != 0i)));
    }
    let _e158 = t;
    let _e160 = col3_;
    let _e162 = t;
    let _e163 = ColorTo;
    return ((_e160 * (1f - _e158)) + (_e163 * _e162));
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e22 = _uv_1;
    param_4 = _e22;
    let _e23 = transition((&param_4));
    _fragColor = _e23;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
