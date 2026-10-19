// InvertedPageCurl — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/InvertedPageCurl.glsl
// Author: Hewlett-Packard
// License: BSD 3 Clause
// Description: The outgoing image curls away like a page, revealing the incoming one
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
var<private> cylinderAngle: f32;
var<private> amount: f32;
@group(0) @binding(0) 
var<uniform> uniforms: Uniforms;
var<private> cylinderCenter: f32;
var<private> _fragColor: vec4<f32>;
var<private> _uv_1: vec2<f32>;

fn distanceToEdge(point: ptr<function, vec3<f32>>) -> f32 {
    var dx: f32;
    var local: f32;
    var dy: f32;
    var local_1: f32;
    var phi_222_: bool;
    var phi_234_: bool;
    var phi_235_: bool;

    let _e51 = (*point)[0u];
    if (_e51 > 0.5f) {
        let _e54 = (*point)[0u];
        local = (1f - _e54);
    } else {
        let _e57 = (*point)[0u];
        local = _e57;
    }
    let _e58 = local;
    dx = abs(_e58);
    let _e61 = (*point)[1u];
    if (_e61 > 0.5f) {
        let _e64 = (*point)[1u];
        local_1 = (1f - _e64);
    } else {
        let _e67 = (*point)[1u];
        local_1 = _e67;
    }
    let _e68 = local_1;
    dy = abs(_e68);
    let _e71 = (*point)[0u];
    if (_e71 < 0f) {
        let _e74 = (*point)[0u];
        dx = -(_e74);
    }
    let _e77 = (*point)[0u];
    if (_e77 > 1f) {
        let _e80 = (*point)[0u];
        dx = (_e80 - 1f);
    }
    let _e83 = (*point)[1u];
    if (_e83 < 0f) {
        let _e86 = (*point)[1u];
        dy = -(_e86);
    }
    let _e89 = (*point)[1u];
    if (_e89 > 1f) {
        let _e92 = (*point)[1u];
        dy = (_e92 - 1f);
    }
    let _e95 = (*point)[0u];
    let _e96 = (_e95 < 0f);
    phi_222_ = _e96;
    if !(_e96) {
        let _e99 = (*point)[0u];
        phi_222_ = (_e99 > 1f);
    }
    let _e102 = phi_222_;
    phi_235_ = _e102;
    if _e102 {
        let _e104 = (*point)[1u];
        let _e105 = (_e104 < 0f);
        phi_234_ = _e105;
        if !(_e105) {
            let _e108 = (*point)[1u];
            phi_234_ = (_e108 > 1f);
        }
        let _e111 = phi_234_;
        phi_235_ = _e111;
    }
    let _e113 = phi_235_;
    if _e113 {
        let _e114 = dx;
        let _e115 = dx;
        let _e117 = dy;
        let _e118 = dy;
        return sqrt(((_e114 * _e115) + (_e117 * _e118)));
    }
    let _e122 = dx;
    let _e123 = dy;
    return min(_e122, _e123);
}

fn antiAlias(color1_: ptr<function, vec4<f32>>, color2_: ptr<function, vec4<f32>>, distanc: ptr<function, f32>) -> vec4<f32> {
    var dd: f32;

    let _e49 = (*distanc);
    (*distanc) = (_e49 * 512f);
    let _e51 = (*distanc);
    if (_e51 < 0f) {
        let _e53 = (*color2_);
        return _e53;
    }
    let _e54 = (*distanc);
    if (_e54 > 2f) {
        let _e56 = (*color1_);
        return _e56;
    }
    let _e57 = (*distanc);
    dd = pow((1f - (_e57 / 2f)), 3f);
    let _e61 = (*color2_);
    let _e62 = (*color1_);
    let _e64 = dd;
    let _e66 = (*color1_);
    return (((_e61 - _e62) * _e64) + _e66);
}

fn getFromColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e47 = (*uv)[0u];
    let _e49 = (*uv)[1u];
    let _e52 = textureSampleLevel(_from, _sampler, vec2<f32>(_e47, (1f - _e49)), 0f);
    return _e52;
}

fn backside(yc: ptr<function, f32>, point_1: ptr<function, vec3<f32>>) -> vec4<f32> {
    var color: vec4<f32>;
    var param: vec2<f32>;
    var gray: f32;

    let _e50 = (*point_1);
    param = _e50.xy;
    let _e52 = getFromColor((&param));
    color = _e52;
    let _e54 = color[0u];
    let _e56 = color[2u];
    let _e59 = color[1u];
    gray = (((_e54 + _e56) + _e59) / 15f);
    let _e62 = (*yc);
    let _e71 = gray;
    gray = (_e71 + (0.8f * ((pow(max(0f, (1f - abs((_e62 / 0.15915494f)))), 0.2f) / 2f) + 0.5f)));
    let _e73 = gray;
    let _e74 = vec3(_e73);
    color[0u] = _e74.x;
    color[1u] = _e74.y;
    color[2u] = _e74.z;
    let _e81 = color;
    return _e81;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e47 = (*uv_1)[0u];
    let _e49 = (*uv_1)[1u];
    let _e52 = textureSampleLevel(_to, _sampler, vec2<f32>(_e47, (1f - _e49)), 0f);
    return _e52;
}

fn hitPoint_u0028_f1_u003b_f1_u003b_vf3_u003b_mf33_u003b(hitAngle: ptr<function, f32>, yc_1: ptr<function, f32>, point_2: ptr<function, vec3<f32>>, rrotation: ptr<function, mat3x3<f32>>) -> vec3<f32> {
    var hitPoint: f32;

    let _e50 = (*hitAngle);
    hitPoint = (_e50 / 6.2831855f);
    let _e52 = hitPoint;
    (*point_2)[1u] = _e52;
    let _e54 = (*rrotation);
    let _e55 = (*point_2);
    return (_e54 * _e55);
}

fn seeThrough(yc_2: ptr<function, f32>, p: ptr<function, vec2<f32>>, rotation: ptr<function, mat3x3<f32>>, rrotation_1: ptr<function, mat3x3<f32>>) -> vec4<f32> {
    var hitAngle_1: f32;
    var point_3: vec3<f32>;
    var param_1: f32;
    var param_2: f32;
    var param_3: vec3<f32>;
    var param_4: mat3x3<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var color_1: vec4<f32>;
    var param_7: vec2<f32>;
    var tcolor: vec4<f32>;
    var param_8: vec3<f32>;
    var param_9: vec4<f32>;
    var param_10: vec4<f32>;
    var param_11: f32;
    var phi_293_: bool;
    var phi_300_: bool;
    var phi_307_: bool;
    var phi_308_: bool;

    let _e64 = (*yc_2);
    let _e68 = cylinderAngle;
    hitAngle_1 = (3.1415927f - (acos(clamp((_e64 / 0.15915494f), -1f, 1f)) - _e68));
    let _e71 = (*rotation);
    let _e72 = (*p);
    let _e77 = hitAngle_1;
    param_1 = _e77;
    let _e78 = (*yc_2);
    param_2 = _e78;
    param_3 = (_e71 * vec3<f32>(_e72.x, _e72.y, 1f));
    let _e79 = (*rrotation_1);
    param_4 = _e79;
    let _e80 = hitPoint_u0028_f1_u003b_f1_u003b_vf3_u003b_mf33_u003b((&param_1), (&param_2), (&param_3), (&param_4));
    point_3 = _e80;
    let _e81 = (*yc_2);
    let _e82 = (_e81 <= 0f);
    phi_308_ = _e82;
    if _e82 {
        let _e84 = point_3[0u];
        let _e85 = (_e84 < 0f);
        phi_293_ = _e85;
        if !(_e85) {
            let _e88 = point_3[1u];
            phi_293_ = (_e88 < 0f);
        }
        let _e91 = phi_293_;
        phi_300_ = _e91;
        if !(_e91) {
            let _e94 = point_3[0u];
            phi_300_ = (_e94 > 1f);
        }
        let _e97 = phi_300_;
        phi_307_ = _e97;
        if !(_e97) {
            let _e100 = point_3[1u];
            phi_307_ = (_e100 > 1f);
        }
        let _e103 = phi_307_;
        phi_308_ = _e103;
    }
    let _e105 = phi_308_;
    if _e105 {
        let _e106 = (*p);
        param_5 = _e106;
        let _e107 = getToColor((&param_5));
        return _e107;
    }
    let _e108 = (*yc_2);
    if (_e108 > 0f) {
        let _e110 = (*p);
        param_6 = _e110;
        let _e111 = getFromColor((&param_6));
        return _e111;
    }
    let _e112 = point_3;
    param_7 = _e112.xy;
    let _e114 = getFromColor((&param_7));
    color_1 = _e114;
    tcolor = vec4<f32>(0f, 0f, 0f, 0f);
    let _e115 = point_3;
    param_8 = _e115;
    let _e116 = distanceToEdge((&param_8));
    let _e117 = color_1;
    param_9 = _e117;
    let _e118 = tcolor;
    param_10 = _e118;
    param_11 = _e116;
    let _e119 = antiAlias((&param_9), (&param_10), (&param_11));
    return _e119;
}

fn seeThroughWithShadow(yc_3: ptr<function, f32>, p_1: ptr<function, vec2<f32>>, point_4: ptr<function, vec3<f32>>, rotation_1: ptr<function, mat3x3<f32>>, rrotation_2: ptr<function, mat3x3<f32>>) -> vec4<f32> {
    var shadow: f32;
    var param_12: vec3<f32>;
    var shadowColor: vec4<f32>;
    var param_13: f32;
    var param_14: vec2<f32>;
    var param_15: mat3x3<f32>;
    var param_16: mat3x3<f32>;

    let _e57 = (*point_4);
    param_12 = _e57;
    let _e58 = distanceToEdge((&param_12));
    shadow = (_e58 * 30f);
    let _e60 = shadow;
    shadow = ((1f - _e60) / 3f);
    let _e63 = shadow;
    if (_e63 < 0f) {
        shadow = 0f;
    } else {
        let _e65 = amount;
        let _e66 = shadow;
        shadow = (_e66 * _e65);
    }
    let _e68 = (*yc_3);
    param_13 = _e68;
    let _e69 = (*p_1);
    param_14 = _e69;
    let _e70 = (*rotation_1);
    param_15 = _e70;
    let _e71 = (*rrotation_2);
    param_16 = _e71;
    let _e72 = seeThrough((&param_13), (&param_14), (&param_15), (&param_16));
    shadowColor = _e72;
    let _e73 = shadow;
    let _e75 = shadowColor[0u];
    shadowColor[0u] = (_e75 - _e73);
    let _e78 = shadow;
    let _e80 = shadowColor[1u];
    shadowColor[1u] = (_e80 - _e78);
    let _e83 = shadow;
    let _e85 = shadowColor[2u];
    shadowColor[2u] = (_e85 - _e83);
    let _e88 = shadowColor;
    return _e88;
}

fn behindSurface(p_2: ptr<function, vec2<f32>>, yc_4: ptr<function, f32>, point_5: ptr<function, vec3<f32>>, rrotation_3: ptr<function, mat3x3<f32>>) -> vec4<f32> {
    var safeAmount: f32;
    var local_2: f32;
    var shado: f32;
    var hitAngle_2: f32;
    var param_17: f32;
    var param_18: f32;
    var param_19: vec3<f32>;
    var param_20: mat3x3<f32>;
    var dx_1: f32;
    var dy_1: f32;
    var nyc: f32;
    var param_21: vec2<f32>;
    var phi_487_: bool;
    var phi_493_: bool;
    var phi_499_: bool;
    var phi_505_: bool;
    var phi_513_: bool;

    let _e61 = amount;
    if (_e61 >= 0f) {
        let _e63 = amount;
        local_2 = max(_e63, 0.0001f);
    } else {
        let _e65 = amount;
        local_2 = min(_e65, -0.0001f);
    }
    let _e67 = local_2;
    safeAmount = _e67;
    let _e68 = (*yc_4);
    let _e70 = safeAmount;
    shado = ((1f - (((-0.15915494f - _e68) / _e70) * 7f)) / 6f);
    let _e76 = (*point_5)[0u];
    let _e80 = shado;
    shado = (_e80 * (1f - abs((_e76 - 0.5f))));
    let _e82 = (*yc_4);
    (*yc_4) = (-0.31830987f - _e82);
    let _e84 = (*yc_4);
    let _e88 = cylinderAngle;
    hitAngle_2 = ((acos(clamp((_e84 / 0.15915494f), -1f, 1f)) + _e88) - 3.1415927f);
    let _e91 = hitAngle_2;
    param_17 = _e91;
    let _e92 = (*yc_4);
    param_18 = _e92;
    let _e93 = (*point_5);
    param_19 = _e93;
    let _e94 = (*rrotation_3);
    param_20 = _e94;
    let _e95 = hitPoint_u0028_f1_u003b_f1_u003b_vf3_u003b_mf33_u003b((&param_17), (&param_18), (&param_19), (&param_20));
    (*point_5) = _e95;
    let _e96 = (*yc_4);
    let _e97 = (_e96 < 0f);
    phi_487_ = _e97;
    if _e97 {
        let _e99 = (*point_5)[0u];
        phi_487_ = (_e99 >= 0f);
    }
    let _e102 = phi_487_;
    phi_493_ = _e102;
    if _e102 {
        let _e104 = (*point_5)[1u];
        phi_493_ = (_e104 >= 0f);
    }
    let _e107 = phi_493_;
    phi_499_ = _e107;
    if _e107 {
        let _e109 = (*point_5)[0u];
        phi_499_ = (_e109 <= 1f);
    }
    let _e112 = phi_499_;
    phi_505_ = _e112;
    if _e112 {
        let _e114 = (*point_5)[1u];
        phi_505_ = (_e114 <= 1f);
    }
    let _e117 = phi_505_;
    phi_513_ = _e117;
    if _e117 {
        let _e118 = hitAngle_2;
        let _e120 = amount;
        phi_513_ = ((_e118 < 3.1415927f) || (_e120 > 0.5f));
    }
    let _e124 = phi_513_;
    if _e124 {
        let _e126 = (*point_5)[0u];
        dx_1 = (_e126 - 0.5f);
        let _e129 = (*point_5)[1u];
        dy_1 = (_e129 - 0.5f);
        let _e131 = dx_1;
        let _e132 = dx_1;
        let _e134 = dy_1;
        let _e135 = dy_1;
        shado = (1f - (sqrt(((_e131 * _e132) + (_e134 * _e135))) / 0.71f));
        let _e141 = (*yc_4);
        nyc = (-(_e141) / 0.15915494f);
        let _e144 = nyc;
        let _e145 = nyc;
        let _e147 = nyc;
        let _e149 = shado;
        shado = (_e149 * ((_e144 * _e145) * _e147));
        let _e151 = shado;
        shado = (_e151 * 0.5f);
    } else {
        shado = 0f;
    }
    let _e153 = (*p_2);
    param_21 = _e153;
    let _e154 = getToColor((&param_21));
    let _e156 = shado;
    let _e158 = (_e154.xyz - vec3(_e156));
    return vec4<f32>(_e158.x, _e158.y, _e158.z, 1f);
}

fn transition(p_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var c: f32;
    var s: f32;
    var rotation_2: mat3x3<f32>;
    var rrotation_4: mat3x3<f32>;
    var point_6: vec3<f32>;
    var yc_5: f32;
    var param_22: vec2<f32>;
    var param_23: f32;
    var param_24: vec3<f32>;
    var param_25: mat3x3<f32>;
    var param_26: vec2<f32>;
    var hitAngle_3: f32;
    var hitAngleMod: f32;
    var param_27: f32;
    var param_28: vec2<f32>;
    var param_29: mat3x3<f32>;
    var param_30: mat3x3<f32>;
    var param_31: f32;
    var param_32: f32;
    var param_33: vec3<f32>;
    var param_34: mat3x3<f32>;
    var param_35: f32;
    var param_36: vec2<f32>;
    var param_37: vec3<f32>;
    var param_38: mat3x3<f32>;
    var param_39: mat3x3<f32>;
    var color_2: vec4<f32>;
    var param_40: f32;
    var param_41: vec3<f32>;
    var dx2_: f32;
    var dy2_: f32;
    var shado_1: f32;
    var nyc2_: f32;
    var otherColor: vec4<f32>;
    var param_42: vec2<f32>;
    var param_43: vec4<f32>;
    var param_44: vec4<f32>;
    var param_45: f32;
    var cl: vec4<f32>;
    var param_46: f32;
    var param_47: vec2<f32>;
    var param_48: vec3<f32>;
    var param_49: mat3x3<f32>;
    var param_50: mat3x3<f32>;
    var dist: f32;
    var param_51: vec3<f32>;
    var param_52: vec4<f32>;
    var param_53: vec4<f32>;
    var param_54: f32;
    var phi_665_: bool;
    var phi_696_: bool;
    var phi_703_: bool;
    var phi_710_: bool;

    let _e96 = uniforms.progress;
    amount = ((_e96 * 1.66f) + -0.16f);
    let _e99 = amount;
    cylinderCenter = _e99;
    let _e100 = amount;
    cylinderAngle = (6.2831855f * _e100);
    c = -0.17364818f;
    s = -0.9848077f;
    let _e102 = c;
    let _e103 = s;
    let _e104 = s;
    let _e106 = c;
    rotation_2 = mat3x3<f32>(vec3<f32>(_e102, _e103, 0f), vec3<f32>(-(_e104), _e106, 0f), vec3<f32>(-0.801f, 0.89f, 1f));
    c = -0.17364818f;
    s = 0.9848077f;
    let _e111 = c;
    let _e112 = s;
    let _e113 = s;
    let _e115 = c;
    rrotation_4 = mat3x3<f32>(vec3<f32>(_e111, _e112, 0f), vec3<f32>(-(_e113), _e115, 0f), vec3<f32>(0.985f, 0.985f, 1f));
    let _e120 = rotation_2;
    let _e121 = (*p_3);
    point_6 = (_e120 * vec3<f32>(_e121.x, _e121.y, 1f));
    let _e127 = point_6[1u];
    let _e128 = cylinderCenter;
    yc_5 = (_e127 - _e128);
    let _e130 = yc_5;
    if (_e130 < -0.15915494f) {
        let _e132 = (*p_3);
        param_22 = _e132;
        let _e133 = yc_5;
        param_23 = _e133;
        let _e134 = point_6;
        param_24 = _e134;
        let _e135 = rrotation_4;
        param_25 = _e135;
        let _e136 = behindSurface((&param_22), (&param_23), (&param_24), (&param_25));
        return _e136;
    }
    let _e137 = yc_5;
    if (_e137 > 0.15915494f) {
        let _e139 = (*p_3);
        param_26 = _e139;
        let _e140 = getFromColor((&param_26));
        return _e140;
    }
    let _e141 = yc_5;
    let _e145 = cylinderAngle;
    hitAngle_3 = ((acos(clamp((_e141 / 0.15915494f), -1f, 1f)) + _e145) - 3.1415927f);
    let _e148 = hitAngle_3;
    hitAngleMod = (_e148 - (floor((_e148 / 6.2831855f)) * 6.2831855f));
    let _e153 = hitAngleMod;
    let _e155 = amount;
    let _e157 = ((_e153 > 3.1415927f) && (_e155 < 0.5f));
    phi_665_ = _e157;
    if !(_e157) {
        let _e159 = hitAngleMod;
        let _e161 = amount;
        phi_665_ = ((_e159 > 1.5707964f) && (_e161 < 0f));
    }
    let _e165 = phi_665_;
    if _e165 {
        let _e166 = yc_5;
        param_27 = _e166;
        let _e167 = (*p_3);
        param_28 = _e167;
        let _e168 = rotation_2;
        param_29 = _e168;
        let _e169 = rrotation_4;
        param_30 = _e169;
        let _e170 = seeThrough((&param_27), (&param_28), (&param_29), (&param_30));
        return _e170;
    }
    let _e171 = hitAngle_3;
    param_31 = _e171;
    let _e172 = yc_5;
    param_32 = _e172;
    let _e173 = point_6;
    param_33 = _e173;
    let _e174 = rrotation_4;
    param_34 = _e174;
    let _e175 = hitPoint_u0028_f1_u003b_f1_u003b_vf3_u003b_mf33_u003b((&param_31), (&param_32), (&param_33), (&param_34));
    point_6 = _e175;
    let _e177 = point_6[0u];
    let _e178 = (_e177 < 0f);
    phi_696_ = _e178;
    if !(_e178) {
        let _e181 = point_6[1u];
        phi_696_ = (_e181 < 0f);
    }
    let _e184 = phi_696_;
    phi_703_ = _e184;
    if !(_e184) {
        let _e187 = point_6[0u];
        phi_703_ = (_e187 > 1f);
    }
    let _e190 = phi_703_;
    phi_710_ = _e190;
    if !(_e190) {
        let _e193 = point_6[1u];
        phi_710_ = (_e193 > 1f);
    }
    let _e196 = phi_710_;
    if _e196 {
        let _e197 = yc_5;
        param_35 = _e197;
        let _e198 = (*p_3);
        param_36 = _e198;
        let _e199 = point_6;
        param_37 = _e199;
        let _e200 = rotation_2;
        param_38 = _e200;
        let _e201 = rrotation_4;
        param_39 = _e201;
        let _e202 = seeThroughWithShadow((&param_35), (&param_36), (&param_37), (&param_38), (&param_39));
        return _e202;
    }
    let _e203 = yc_5;
    param_40 = _e203;
    let _e204 = point_6;
    param_41 = _e204;
    let _e205 = backside((&param_40), (&param_41));
    color_2 = _e205;
    let _e206 = yc_5;
    if (_e206 < 0f) {
        let _e209 = point_6[0u];
        dx2_ = (_e209 - 0.5f);
        let _e212 = point_6[1u];
        dy2_ = (_e212 - 0.5f);
        let _e214 = dx2_;
        let _e215 = dx2_;
        let _e217 = dy2_;
        let _e218 = dy2_;
        shado_1 = (1f - (sqrt(((_e214 * _e215) + (_e217 * _e218))) / 0.71f));
        let _e224 = yc_5;
        nyc2_ = (-(_e224) / 0.15915494f);
        let _e227 = nyc2_;
        let _e228 = nyc2_;
        let _e230 = nyc2_;
        let _e232 = shado_1;
        shado_1 = (_e232 * ((_e227 * _e228) * _e230));
        let _e234 = shado_1;
        shado_1 = (_e234 * 0.5f);
        let _e236 = shado_1;
        otherColor = vec4<f32>(0f, 0f, 0f, _e236);
    } else {
        let _e238 = (*p_3);
        param_42 = _e238;
        let _e239 = getFromColor((&param_42));
        otherColor = _e239;
    }
    let _e240 = yc_5;
    let _e243 = color_2;
    param_43 = _e243;
    let _e244 = otherColor;
    param_44 = _e244;
    param_45 = (0.15915494f - abs(_e240));
    let _e245 = antiAlias((&param_43), (&param_44), (&param_45));
    color_2 = _e245;
    let _e246 = yc_5;
    param_46 = _e246;
    let _e247 = (*p_3);
    param_47 = _e247;
    let _e248 = point_6;
    param_48 = _e248;
    let _e249 = rotation_2;
    param_49 = _e249;
    let _e250 = rrotation_4;
    param_50 = _e250;
    let _e251 = seeThroughWithShadow((&param_46), (&param_47), (&param_48), (&param_49), (&param_50));
    cl = _e251;
    let _e252 = point_6;
    param_51 = _e252;
    let _e253 = distanceToEdge((&param_51));
    dist = _e253;
    let _e254 = color_2;
    param_52 = _e254;
    let _e255 = cl;
    param_53 = _e255;
    let _e256 = dist;
    param_54 = _e256;
    let _e257 = antiAlias((&param_52), (&param_53), (&param_54));
    return _e257;
}

fn main_1() {
    var param_55: vec2<f32>;

    let _e46 = _uv_1;
    param_55 = _e46;
    let _e47 = transition((&param_55));
    _fragColor = _e47;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
