// StereoViewer — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/StereoViewer.glsl
// Author: Ted Schundler
// License: BSD 2 Clause
// Description: Both images shrink into rounded cards that swap, like a stereo viewer toy
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    zoom: f32,
    corner_radius: f32,
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
    let _e32 = (*uv)[0u];
    let _e34 = (*uv)[1u];
    let _e37 = textureSampleLevel(_to, _sampler, vec2<f32>(_e32, (1f - _e34)), 0f);
    return _e37;
}

fn in_corner(p: ptr<function, vec2<f32>>, corner: ptr<function, vec2<f32>>, radius: ptr<function, vec2<f32>>) -> bool {
    var axis: vec2<f32>;
    var phi_156_: bool;
    var phi_168_: bool;
    var phi_169_: bool;
    var phi_177_: bool;

    let _e34 = (*corner);
    let _e36 = (*corner);
    axis = ((vec2<f32>(1f, 1f) - _e34) - _e36);
    let _e38 = (*p);
    let _e39 = (*corner);
    let _e40 = axis;
    let _e41 = (*radius);
    (*p) = (_e38 - (_e39 + (_e40 * _e41)));
    let _e45 = axis;
    let _e46 = (*radius);
    let _e48 = (*p);
    (*p) = (_e48 * (_e45 / _e46));
    let _e51 = (*p)[0u];
    let _e52 = (_e51 > 0f);
    phi_156_ = _e52;
    if _e52 {
        let _e54 = (*p)[1u];
        phi_156_ = (_e54 > -1f);
    }
    let _e57 = phi_156_;
    phi_169_ = _e57;
    if !(_e57) {
        let _e60 = (*p)[1u];
        let _e61 = (_e60 > 0f);
        phi_168_ = _e61;
        if _e61 {
            let _e63 = (*p)[0u];
            phi_168_ = (_e63 > -1f);
        }
        let _e66 = phi_168_;
        phi_169_ = _e66;
    }
    let _e68 = phi_169_;
    phi_177_ = _e68;
    if !(_e68) {
        let _e70 = (*p);
        let _e71 = (*p);
        phi_177_ = (dot(_e70, _e71) < 1f);
    }
    let _e75 = phi_177_;
    return _e75;
}

fn test_rounded_mask(p_1: ptr<function, vec2<f32>>, corner_size: ptr<function, vec2<f32>>) -> bool {
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;
    var param_11: vec2<f32>;
    var phi_196_: bool;
    var phi_206_: bool;
    var phi_215_: bool;

    let _e44 = (*p_1);
    param = _e44;
    param_1 = vec2<f32>(0f, 0f);
    let _e45 = (*corner_size);
    param_2 = _e45;
    let _e46 = in_corner((&param), (&param_1), (&param_2));
    phi_196_ = _e46;
    if _e46 {
        let _e47 = (*p_1);
        param_3 = _e47;
        param_4 = vec2<f32>(0f, 1f);
        let _e48 = (*corner_size);
        param_5 = _e48;
        let _e49 = in_corner((&param_3), (&param_4), (&param_5));
        phi_196_ = _e49;
    }
    let _e51 = phi_196_;
    phi_206_ = _e51;
    if _e51 {
        let _e52 = (*p_1);
        param_6 = _e52;
        param_7 = vec2<f32>(1f, 0f);
        let _e53 = (*corner_size);
        param_8 = _e53;
        let _e54 = in_corner((&param_6), (&param_7), (&param_8));
        phi_206_ = _e54;
    }
    let _e56 = phi_206_;
    phi_215_ = _e56;
    if _e56 {
        let _e57 = (*p_1);
        param_9 = _e57;
        param_10 = vec2<f32>(1f, 1f);
        let _e58 = (*corner_size);
        param_11 = _e58;
        let _e59 = in_corner((&param_9), (&param_10), (&param_11));
        phi_215_ = _e59;
    }
    let _e61 = phi_215_;
    return _e61;
}

fn simple_sample_with_corners_to(p_2: ptr<function, vec2<f32>>, corner_size_1: ptr<function, vec2<f32>>, zoom_amt: ptr<function, f32>) -> vec4<f32> {
    var param_12: vec2<f32>;
    var param_13: vec2<f32>;
    var param_14: vec2<f32>;

    let _e36 = (*p_2);
    let _e39 = (*zoom_amt);
    let _e42 = uniforms.zoom;
    let _e43 = (*zoom_amt);
    (*p_2) = (((_e36 - vec2(0.5f)) / vec2(((1f - _e39) + (_e42 * _e43)))) + vec2(0.5f));
    let _e50 = (*p_2);
    param_12 = _e50;
    let _e51 = (*corner_size_1);
    param_13 = _e51;
    let _e52 = test_rounded_mask((&param_12), (&param_13));
    if !(_e52) {
        return vec4<f32>(0f, 0f, 0f, 1f);
    }
    let _e54 = (*p_2);
    param_14 = _e54;
    let _e55 = getToColor((&param_14));
    return _e55;
}

fn screen(a: ptr<function, vec4<f32>>, b: ptr<function, vec4<f32>>) -> vec4<f32> {
    let _e32 = (*a);
    let _e35 = (*b);
    return (vec4(1f) - ((vec4(1f) - _e32) * (vec4(1f) - _e35)));
}

fn unscreen(c: ptr<function, vec4<f32>>) -> vec4<f32> {
    let _e31 = (*c);
    return (vec4(1f) - sqrt((vec4(1f) - _e31)));
}

fn sample_with_corners_to(p_3: ptr<function, vec2<f32>>, corner_size_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_15: vec2<f32>;
    var param_16: vec2<f32>;
    var param_17: vec2<f32>;
    var param_18: vec4<f32>;

    let _e36 = (*p_3);
    let _e40 = uniforms.zoom;
    (*p_3) = (((_e36 - vec2(0.5f)) / vec2(_e40)) + vec2(0.5f));
    let _e45 = (*p_3);
    param_15 = _e45;
    let _e46 = (*corner_size_2);
    param_16 = _e46;
    let _e47 = test_rounded_mask((&param_15), (&param_16));
    if !(_e47) {
        return vec4<f32>(0f, 0f, 0f, 1f);
    }
    let _e49 = (*p_3);
    param_17 = _e49;
    let _e50 = getToColor((&param_17));
    param_18 = _e50;
    let _e51 = unscreen((&param_18));
    return _e51;
}

fn rotate2d(angle: ptr<function, f32>, ratio: ptr<function, f32>) -> mat3x3<f32> {
    var s: f32;
    var c_1: f32;

    let _e34 = (*angle);
    s = sin(_e34);
    let _e36 = (*angle);
    c_1 = cos(_e36);
    let _e38 = c_1;
    let _e39 = s;
    let _e40 = s;
    let _e42 = c_1;
    return mat3x3<f32>(vec3<f32>(_e38, _e39, 0f), vec3<f32>(-(_e40), _e42, 0f), vec3<f32>(0f, 0f, 1f));
}

fn scale2d(x: ptr<function, f32>, y: ptr<function, f32>) -> mat3x3<f32> {
    let _e32 = (*x);
    let _e33 = (*y);
    return mat3x3<f32>(vec3<f32>(_e32, 0f, 0f), vec3<f32>(0f, _e33, 0f), vec3<f32>(0f, 0f, 1f));
}

fn translate2d(x_1: ptr<function, f32>, y_1: ptr<function, f32>) -> mat3x3<f32> {
    let _e32 = (*x_1);
    let _e34 = (*y_1);
    return mat3x3<f32>(vec3<f32>(1f, 0f, 0f), vec3<f32>(0f, 1f, 0f), vec3<f32>(-(_e32), -(_e34), 1f));
}

fn get_cross_masked(p3_: ptr<function, vec3<f32>>, angle_1: ptr<function, f32>, corner_size_3: ptr<function, vec2<f32>>, ratio_1: ptr<function, f32>) -> vec4<f32> {
    var center_and_scale: mat3x3<f32>;
    var param_19: f32;
    var param_20: f32;
    var param_21: f32;
    var param_22: f32;
    var unscale_and_uncenter: mat3x3<f32>;
    var param_23: f32;
    var param_24: f32;
    var param_25: f32;
    var param_26: f32;
    var slide_left: mat3x3<f32>;
    var param_27: f32;
    var param_28: f32;
    var slide_right: mat3x3<f32>;
    var param_29: f32;
    var param_30: f32;
    var rotate: mat3x3<f32>;
    var param_31: f32;
    var param_32: f32;
    var op_a: mat3x3<f32>;
    var op_b: mat3x3<f32>;
    var mask_a: bool;
    var param_33: vec2<f32>;
    var param_34: vec2<f32>;
    var mask_b: bool;
    var param_35: vec2<f32>;
    var param_36: vec2<f32>;
    var img: vec4<f32>;
    var param_37: vec2<f32>;
    var param_38: vec2<f32>;
    var param_39: vec4<f32>;
    var param_40: vec4<f32>;

    let _e66 = (*angle_1);
    (*angle_1) = (1f - _e66);
    let _e68 = (*angle_1);
    let _e69 = (*angle_1);
    (*angle_1) = (_e68 * _e69);
    let _e71 = (*angle_1);
    (*angle_1) = (_e71 / 2.4f);
    param_19 = -0.5f;
    param_20 = -0.5f;
    let _e73 = translate2d((&param_19), (&param_20));
    param_21 = 1f;
    let _e74 = (*ratio_1);
    param_22 = _e74;
    let _e75 = scale2d((&param_21), (&param_22));
    center_and_scale = (_e73 * _e75);
    let _e78 = uniforms.zoom;
    let _e81 = uniforms.zoom;
    let _e82 = (*ratio_1);
    param_23 = (1f / _e78);
    param_24 = (1f / (_e81 * _e82));
    let _e85 = scale2d((&param_23), (&param_24));
    param_25 = 0.5f;
    param_26 = 0.5f;
    let _e86 = translate2d((&param_25), (&param_26));
    unscale_and_uncenter = (_e85 * _e86);
    param_27 = -2f;
    param_28 = 0f;
    let _e88 = translate2d((&param_27), (&param_28));
    slide_left = _e88;
    param_29 = 2f;
    param_30 = 0f;
    let _e89 = translate2d((&param_29), (&param_30));
    slide_right = _e89;
    let _e90 = (*angle_1);
    param_31 = _e90;
    let _e91 = (*ratio_1);
    param_32 = _e91;
    let _e92 = rotate2d((&param_31), (&param_32));
    rotate = _e92;
    let _e93 = center_and_scale;
    let _e94 = slide_right;
    let _e96 = rotate;
    let _e98 = slide_left;
    let _e100 = unscale_and_uncenter;
    op_a = ((((_e93 * _e94) * _e96) * _e98) * _e100);
    let _e102 = center_and_scale;
    let _e103 = slide_left;
    let _e105 = rotate;
    let _e107 = slide_right;
    let _e109 = unscale_and_uncenter;
    op_b = ((((_e102 * _e103) * _e105) * _e107) * _e109);
    let _e111 = op_a;
    let _e112 = (*p3_);
    param_33 = (_e111 * _e112).xy;
    let _e115 = (*corner_size_3);
    param_34 = _e115;
    let _e116 = test_rounded_mask((&param_33), (&param_34));
    mask_a = _e116;
    let _e117 = op_b;
    let _e118 = (*p3_);
    param_35 = (_e117 * _e118).xy;
    let _e121 = (*corner_size_3);
    param_36 = _e121;
    let _e122 = test_rounded_mask((&param_35), (&param_36));
    mask_b = _e122;
    let _e123 = mask_a;
    let _e124 = mask_b;
    if (_e123 || _e124) {
        let _e126 = (*p3_);
        param_37 = _e126.xy;
        let _e128 = (*corner_size_3);
        param_38 = _e128;
        let _e129 = sample_with_corners_to((&param_37), (&param_38));
        img = _e129;
        let _e130 = mask_a;
        let _e131 = img;
        let _e134 = mask_b;
        let _e135 = img;
        param_39 = select(vec4<f32>(0f, 0f, 0f, 1f), _e131, vec4(_e130));
        param_40 = select(vec4<f32>(0f, 0f, 0f, 1f), _e135, vec4(_e134));
        let _e138 = screen((&param_39), (&param_40));
        return _e138;
    } else {
        return vec4<f32>(0f, 0f, 0f, 1f);
    }
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e32 = (*uv_1)[0u];
    let _e34 = (*uv_1)[1u];
    let _e37 = textureSampleLevel(_from, _sampler, vec2<f32>(_e32, (1f - _e34)), 0f);
    return _e37;
}

fn sample_with_corners_from(p_4: ptr<function, vec2<f32>>, corner_size_4: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_41: vec2<f32>;
    var param_42: vec2<f32>;
    var param_43: vec2<f32>;
    var param_44: vec4<f32>;

    let _e36 = (*p_4);
    let _e40 = uniforms.zoom;
    (*p_4) = (((_e36 - vec2(0.5f)) / vec2(_e40)) + vec2(0.5f));
    let _e45 = (*p_4);
    param_41 = _e45;
    let _e46 = (*corner_size_4);
    param_42 = _e46;
    let _e47 = test_rounded_mask((&param_41), (&param_42));
    if !(_e47) {
        return vec4<f32>(0f, 0f, 0f, 1f);
    }
    let _e49 = (*p_4);
    param_43 = _e49;
    let _e50 = getFromColor((&param_43));
    param_44 = _e50;
    let _e51 = unscreen((&param_44));
    return _e51;
}

fn get_cross_rotated(p3_1: ptr<function, vec3<f32>>, angle_2: ptr<function, f32>, corner_size_5: ptr<function, vec2<f32>>, ratio_2: ptr<function, f32>) -> vec4<f32> {
    var center_and_scale_1: mat3x3<f32>;
    var param_45: f32;
    var param_46: f32;
    var param_47: f32;
    var param_48: f32;
    var unscale_and_uncenter_1: mat3x3<f32>;
    var param_49: f32;
    var param_50: f32;
    var param_51: f32;
    var param_52: f32;
    var slide_left_1: mat3x3<f32>;
    var param_53: f32;
    var param_54: f32;
    var slide_right_1: mat3x3<f32>;
    var param_55: f32;
    var param_56: f32;
    var rotate_1: mat3x3<f32>;
    var param_57: f32;
    var param_58: f32;
    var op_a_1: mat3x3<f32>;
    var op_b_1: mat3x3<f32>;
    var a_1: vec4<f32>;
    var param_59: vec2<f32>;
    var param_60: vec2<f32>;
    var b_1: vec4<f32>;
    var param_61: vec2<f32>;
    var param_62: vec2<f32>;
    var param_63: vec4<f32>;
    var param_64: vec4<f32>;

    let _e63 = (*angle_2);
    let _e64 = (*angle_2);
    (*angle_2) = (_e63 * _e64);
    let _e66 = (*angle_2);
    (*angle_2) = (_e66 / 2.4f);
    param_45 = -0.5f;
    param_46 = -0.5f;
    let _e68 = translate2d((&param_45), (&param_46));
    param_47 = 1f;
    let _e69 = (*ratio_2);
    param_48 = _e69;
    let _e70 = scale2d((&param_47), (&param_48));
    center_and_scale_1 = (_e68 * _e70);
    let _e72 = (*ratio_2);
    param_49 = 1f;
    param_50 = (1f / _e72);
    let _e74 = scale2d((&param_49), (&param_50));
    param_51 = 0.5f;
    param_52 = 0.5f;
    let _e75 = translate2d((&param_51), (&param_52));
    unscale_and_uncenter_1 = (_e74 * _e75);
    param_53 = -2f;
    param_54 = 0f;
    let _e77 = translate2d((&param_53), (&param_54));
    slide_left_1 = _e77;
    param_55 = 2f;
    param_56 = 0f;
    let _e78 = translate2d((&param_55), (&param_56));
    slide_right_1 = _e78;
    let _e79 = (*angle_2);
    param_57 = _e79;
    let _e80 = (*ratio_2);
    param_58 = _e80;
    let _e81 = rotate2d((&param_57), (&param_58));
    rotate_1 = _e81;
    let _e82 = center_and_scale_1;
    let _e83 = slide_right_1;
    let _e85 = rotate_1;
    let _e87 = slide_left_1;
    let _e89 = unscale_and_uncenter_1;
    op_a_1 = ((((_e82 * _e83) * _e85) * _e87) * _e89);
    let _e91 = center_and_scale_1;
    let _e92 = slide_left_1;
    let _e94 = rotate_1;
    let _e96 = slide_right_1;
    let _e98 = unscale_and_uncenter_1;
    op_b_1 = ((((_e91 * _e92) * _e94) * _e96) * _e98);
    let _e100 = op_a_1;
    let _e101 = (*p3_1);
    param_59 = (_e100 * _e101).xy;
    let _e104 = (*corner_size_5);
    param_60 = _e104;
    let _e105 = sample_with_corners_from((&param_59), (&param_60));
    a_1 = _e105;
    let _e106 = op_b_1;
    let _e107 = (*p3_1);
    param_61 = (_e106 * _e107).xy;
    let _e110 = (*corner_size_5);
    param_62 = _e110;
    let _e111 = sample_with_corners_from((&param_61), (&param_62));
    b_1 = _e111;
    let _e112 = a_1;
    param_63 = _e112;
    let _e113 = b_1;
    param_64 = _e113;
    let _e114 = screen((&param_63), (&param_64));
    return _e114;
}

fn simple_sample_with_corners_from(p_5: ptr<function, vec2<f32>>, corner_size_6: ptr<function, vec2<f32>>, zoom_amt_1: ptr<function, f32>) -> vec4<f32> {
    var param_65: vec2<f32>;
    var param_66: vec2<f32>;
    var param_67: vec2<f32>;

    let _e36 = (*p_5);
    let _e39 = (*zoom_amt_1);
    let _e42 = uniforms.zoom;
    let _e43 = (*zoom_amt_1);
    (*p_5) = (((_e36 - vec2(0.5f)) / vec2(((1f - _e39) + (_e42 * _e43)))) + vec2(0.5f));
    let _e50 = (*p_5);
    param_65 = _e50;
    let _e51 = (*corner_size_6);
    param_66 = _e51;
    let _e52 = test_rounded_mask((&param_65), (&param_66));
    if !(_e52) {
        return vec4<f32>(0f, 0f, 0f, 1f);
    }
    let _e54 = (*p_5);
    param_67 = _e54;
    let _e55 = getFromColor((&param_67));
    return _e55;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p_6: vec2<f32>;
    var p3_2: vec3<f32>;
    var corner_size_7: vec2<f32>;
    var param_68: vec2<f32>;
    var a_2: f32;
    var param_69: vec2<f32>;
    var param_70: vec2<f32>;
    var param_71: f32;
    var param_72: vec3<f32>;
    var param_73: f32;
    var param_74: vec2<f32>;
    var param_75: f32;
    var param_76: vec3<f32>;
    var param_77: f32;
    var param_78: vec2<f32>;
    var param_79: f32;
    var param_80: vec2<f32>;
    var param_81: vec2<f32>;
    var param_82: f32;
    var param_83: vec2<f32>;

    let _e51 = (*uv_2);
    p_6 = (_e51 / vec2<f32>(1f, 1f));
    let _e53 = p_6;
    p3_2 = vec3<f32>(_e53.x, _e53.y, 1f);
    let _e58 = uniforms.corner_radius;
    let _e60 = uniforms.ratio;
    let _e63 = uniforms.corner_radius;
    corner_size_7 = vec2<f32>((_e58 / _e60), _e63);
    let _e66 = uniforms.progress;
    if (_e66 <= 0f) {
        let _e68 = p_6;
        param_68 = _e68;
        let _e69 = getFromColor((&param_68));
        return _e69;
    } else {
        let _e71 = uniforms.progress;
        if (_e71 < 0.1f) {
            let _e74 = uniforms.progress;
            a_2 = (_e74 / 0.1f);
            let _e76 = corner_size_7;
            let _e77 = a_2;
            let _e79 = p_6;
            param_69 = _e79;
            param_70 = (_e76 * _e77);
            let _e80 = a_2;
            param_71 = _e80;
            let _e81 = simple_sample_with_corners_from((&param_69), (&param_70), (&param_71));
            return _e81;
        } else {
            let _e83 = uniforms.progress;
            if (_e83 < 0.48f) {
                let _e86 = uniforms.progress;
                a_2 = ((_e86 - 0.1f) / 0.38f);
                let _e89 = p3_2;
                param_72 = _e89;
                let _e90 = a_2;
                param_73 = _e90;
                let _e91 = corner_size_7;
                param_74 = _e91;
                let _e93 = uniforms.ratio;
                param_75 = _e93;
                let _e94 = get_cross_rotated((&param_72), (&param_73), (&param_74), (&param_75));
                return _e94;
            } else {
                let _e96 = uniforms.progress;
                if (_e96 < 0.9f) {
                    let _e99 = uniforms.progress;
                    let _e102 = p3_2;
                    param_76 = _e102;
                    param_77 = ((_e99 - 0.52f) / 0.38f);
                    let _e103 = corner_size_7;
                    param_78 = _e103;
                    let _e105 = uniforms.ratio;
                    param_79 = _e105;
                    let _e106 = get_cross_masked((&param_76), (&param_77), (&param_78), (&param_79));
                    return _e106;
                } else {
                    let _e108 = uniforms.progress;
                    if (_e108 < 1f) {
                        let _e111 = uniforms.progress;
                        a_2 = ((1f - _e111) / 0.1f);
                        let _e114 = corner_size_7;
                        let _e115 = a_2;
                        let _e117 = p_6;
                        param_80 = _e117;
                        param_81 = (_e114 * _e115);
                        let _e118 = a_2;
                        param_82 = _e118;
                        let _e119 = simple_sample_with_corners_to((&param_80), (&param_81), (&param_82));
                        return _e119;
                    } else {
                        let _e120 = p_6;
                        param_83 = _e120;
                        let _e121 = getToColor((&param_83));
                        return _e121;
                    }
                }
            }
        }
    }
}

fn main_1() {
    var param_84: vec2<f32>;

    let _e31 = _uv_1;
    param_84 = _e31;
    let _e32 = transition((&param_84));
    _fragColor = _e32;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
