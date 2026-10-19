// Box — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Box.glsl
// Author: lql
// License: MIT
// Description: The outgoing image shrinks into a box, toward the center or a corner, revealing the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    rectIn: i32,
    location: i32,
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

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p: f32;
    var local: f32;
    var x1_: f32;
    var y1_: f32;
    var x2_: f32;
    var y2_: f32;
    var local_1: f32;
    var local_2: f32;
    var in_rect: f32;
    var local_3: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var phi_108_: bool;
    var phi_125_: bool;
    var phi_142_: bool;
    var phi_154_: bool;

    let _e29 = uniforms.rectIn;
    if (_e29 == 1i) {
        let _e32 = uniforms.progress;
        local = (1f - _e32);
    } else {
        let _e35 = uniforms.progress;
        local = _e35;
    }
    let _e36 = local;
    p = _e36;
    let _e38 = uniforms.location;
    if (_e38 == 0i) {
        let _e40 = p;
        let _e42 = (0.5f * (1f - _e40));
        y1_ = _e42;
        x1_ = _e42;
        let _e43 = x1_;
        let _e44 = (1f - _e43);
        y2_ = _e44;
        x2_ = _e44;
    } else {
        let _e46 = uniforms.location;
        let _e47 = (_e46 == 1i);
        phi_108_ = _e47;
        if !(_e47) {
            let _e50 = uniforms.location;
            phi_108_ = (_e50 == 2i);
        }
        let _e53 = phi_108_;
        if _e53 {
            local_1 = 0f;
        } else {
            let _e54 = p;
            local_1 = (1f - _e54);
        }
        let _e56 = local_1;
        x1_ = _e56;
        let _e58 = uniforms.location;
        let _e59 = (_e58 == 1i);
        phi_125_ = _e59;
        if !(_e59) {
            let _e62 = uniforms.location;
            phi_125_ = (_e62 == 3i);
        }
        let _e65 = phi_125_;
        if _e65 {
            let _e66 = p;
            local_2 = (1f - _e66);
        } else {
            local_2 = 0f;
        }
        let _e68 = local_2;
        y1_ = _e68;
        let _e70 = uniforms.location;
        let _e71 = (_e70 == 1i);
        phi_142_ = _e71;
        if !(_e71) {
            let _e74 = uniforms.location;
            phi_142_ = (_e74 == 2i);
        }
        let _e77 = phi_142_;
        let _e78 = p;
        x2_ = select(1f, _e78, _e77);
        let _e81 = uniforms.location;
        let _e82 = (_e81 == 1i);
        phi_154_ = _e82;
        if !(_e82) {
            let _e85 = uniforms.location;
            phi_154_ = (_e85 == 3i);
        }
        let _e88 = phi_154_;
        let _e89 = p;
        y2_ = select(_e89, 1f, _e88);
    }
    let _e91 = x1_;
    let _e93 = (*uv_2)[0u];
    let _e96 = (*uv_2)[0u];
    let _e97 = x2_;
    let _e100 = y1_;
    let _e102 = (*uv_2)[1u];
    let _e106 = (*uv_2)[1u];
    let _e107 = y2_;
    in_rect = (((step(_e91, _e93) * step(_e96, _e97)) * step(_e100, _e102)) * step(_e106, _e107));
    let _e111 = uniforms.rectIn;
    if (_e111 == 1i) {
        let _e113 = in_rect;
        local_3 = (1f - _e113);
    } else {
        let _e115 = in_rect;
        local_3 = _e115;
    }
    let _e116 = local_3;
    in_rect = _e116;
    let _e117 = (*uv_2);
    param = _e117;
    let _e118 = getFromColor((&param));
    let _e119 = (*uv_2);
    param_1 = _e119;
    let _e120 = getToColor((&param_1));
    let _e121 = in_rect;
    return mix(_e118, _e120, vec4(_e121));
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
