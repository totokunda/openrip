// Rolls — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Rolls.glsl
// Author: Mark Craig
// License: MIT
// Description: The outgoing image rolls away around a corner, revealing the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    type_: i32,
    RotDown: i32,
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
    let _e19 = (*uv)[0u];
    let _e21 = (*uv)[1u];
    let _e24 = textureSampleLevel(_to, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e19 = (*uv_1)[0u];
    let _e21 = (*uv_1)[1u];
    let _e24 = textureSampleLevel(_from, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var iResolution: vec2<f32>;
    var theta: f32;
    var uvi: vec2<f32>;
    var c1_: f32;
    var s1_: f32;
    var uv2_: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var phi_200_: bool;
    var phi_206_: bool;
    var phi_214_: bool;

    let _e27 = uniforms.ratio;
    iResolution = vec2<f32>(_e27, 1f);
    let _e30 = uniforms.type_;
    if (_e30 == 0i) {
        let _e33 = uniforms.RotDown;
        let _e38 = uniforms.progress;
        theta = ((select(-3.1415927f, 3.1415927f, (_e33 != 0i)) / 2f) * _e38);
        let _e41 = (*uv_2)[0u];
        uvi[0u] = (1f - _e41);
        let _e45 = (*uv_2)[1u];
        uvi[1u] = _e45;
    } else {
        let _e48 = uniforms.type_;
        if (_e48 == 1i) {
            let _e51 = uniforms.RotDown;
            let _e56 = uniforms.progress;
            theta = ((select(-3.1415927f, 3.1415927f, (_e51 != 0i)) / 2f) * _e56);
            let _e58 = (*uv_2);
            uvi = _e58;
        } else {
            let _e60 = uniforms.type_;
            if (_e60 == 2i) {
                let _e63 = uniforms.RotDown;
                let _e68 = uniforms.progress;
                theta = ((select(3.1415927f, -3.1415927f, (_e63 != 0i)) / 2f) * _e68);
                let _e71 = (*uv_2)[0u];
                uvi[0u] = _e71;
                let _e74 = (*uv_2)[1u];
                uvi[1u] = (1f - _e74);
            } else {
                let _e78 = uniforms.type_;
                if (_e78 == 3i) {
                    let _e81 = uniforms.RotDown;
                    let _e86 = uniforms.progress;
                    theta = ((select(3.1415927f, -3.1415927f, (_e81 != 0i)) / 2f) * _e86);
                    let _e88 = (*uv_2);
                    uvi = (vec2(1f) - _e88);
                }
            }
        }
    }
    let _e91 = theta;
    c1_ = cos(_e91);
    let _e93 = theta;
    s1_ = sin(_e93);
    let _e96 = uvi[0u];
    let _e98 = iResolution[0u];
    let _e100 = c1_;
    let _e103 = uvi[1u];
    let _e105 = iResolution[1u];
    let _e107 = s1_;
    uv2_[0u] = (((_e96 * _e98) * _e100) - ((_e103 * _e105) * _e107));
    let _e112 = uvi[0u];
    let _e114 = iResolution[0u];
    let _e116 = s1_;
    let _e119 = uvi[1u];
    let _e121 = iResolution[1u];
    let _e123 = c1_;
    uv2_[1u] = (((_e112 * _e114) * _e116) + ((_e119 * _e121) * _e123));
    let _e128 = uv2_[0u];
    let _e129 = (_e128 >= 0f);
    phi_200_ = _e129;
    if _e129 {
        let _e131 = uv2_[0u];
        let _e133 = iResolution[0u];
        phi_200_ = (_e131 <= _e133);
    }
    let _e136 = phi_200_;
    phi_206_ = _e136;
    if _e136 {
        let _e138 = uv2_[1u];
        phi_206_ = (_e138 >= 0f);
    }
    let _e141 = phi_206_;
    phi_214_ = _e141;
    if _e141 {
        let _e143 = uv2_[1u];
        let _e145 = iResolution[1u];
        phi_214_ = (_e143 <= _e145);
    }
    let _e148 = phi_214_;
    if _e148 {
        let _e149 = iResolution;
        let _e150 = uv2_;
        uv2_ = (_e150 / _e149);
        let _e153 = uniforms.type_;
        if (_e153 == 0i) {
            let _e156 = uv2_[0u];
            uv2_[0u] = (1f - _e156);
        } else {
            let _e160 = uniforms.type_;
            if (_e160 == 2i) {
                let _e163 = uv2_[1u];
                uv2_[1u] = (1f - _e163);
            } else {
                let _e167 = uniforms.type_;
                if (_e167 == 3i) {
                    let _e169 = uv2_;
                    uv2_ = (vec2(1f) - _e169);
                }
            }
        }
        let _e172 = uv2_;
        param = _e172;
        let _e173 = getFromColor((&param));
        return _e173;
    }
    let _e174 = (*uv_2);
    param_1 = _e174;
    let _e175 = getToColor((&param_1));
    return _e175;
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e18 = _uv_1;
    param_2 = _e18;
    let _e19 = transition((&param_2));
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
