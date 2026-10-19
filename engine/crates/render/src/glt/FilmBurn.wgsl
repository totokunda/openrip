// FilmBurn — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/FilmBurn.glsl
// Author: Anastasia Dunbar
// License: MIT
// Description: Glowing film-burn light leaks wash over the image and reveal the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    Seed: f32,
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

fn sigmoid(x: ptr<function, f32>, a: ptr<function, f32>) -> f32 {
    var b: f32;

    let _e51 = (*x);
    let _e53 = (*a);
    b = (pow((_e51 * 2f), _e53) / 2f);
    let _e56 = (*x);
    if (_e56 > 0.5f) {
        let _e58 = (*x);
        let _e61 = (*a);
        b = (1f - (pow((2f - (_e58 * 2f)), _e61) / 2f));
    }
    let _e65 = b;
    return _e65;
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e50 = (*uv)[0u];
    let _e52 = (*uv)[1u];
    let _e55 = textureSampleLevel(_to, _sampler, vec2<f32>(_e50, (1f - _e52)), 0f);
    return _e55;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e50 = (*uv_1)[0u];
    let _e52 = (*uv_1)[1u];
    let _e55 = textureSampleLevel(_from, _sampler, vec2<f32>(_e50, (1f - _e52)), 0f);
    return _e55;
}

fn blendedColor(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: f32;
    var param_3: f32;

    let _e53 = (*p);
    param = _e53;
    let _e54 = getFromColor((&param));
    let _e55 = (*p);
    param_1 = _e55;
    let _e56 = getToColor((&param_1));
    let _e58 = uniforms.progress;
    param_2 = _e58;
    param_3 = 10f;
    let _e59 = sigmoid((&param_2), (&param_3));
    return mix(_e54, _e56, vec4(_e59));
}

fn rand_u0028_vf2_u003b(co: ptr<function, vec2<f32>>) -> f32 {
    let _e49 = (*co);
    return fract((sin(dot(_e49, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn apow(a_1: ptr<function, f32>, b_1: ptr<function, f32>) -> f32 {
    let _e50 = (*a_1);
    let _e52 = (*b_1);
    let _e54 = (*b_1);
    return (pow(abs(_e50), _e52) * sign(_e54));
}

fn pow3(a_2: ptr<function, vec3<f32>>, b_2: ptr<function, vec3<f32>>) -> vec3<f32> {
    var param_4: f32;
    var param_5: f32;
    var param_6: f32;
    var param_7: f32;
    var param_8: f32;
    var param_9: f32;

    let _e57 = (*a_2)[0u];
    param_4 = _e57;
    let _e59 = (*b_2)[0u];
    param_5 = _e59;
    let _e60 = apow((&param_4), (&param_5));
    let _e62 = (*a_2)[1u];
    param_6 = _e62;
    let _e64 = (*b_2)[1u];
    param_7 = _e64;
    let _e65 = apow((&param_6), (&param_7));
    let _e67 = (*a_2)[2u];
    param_8 = _e67;
    let _e69 = (*b_2)[2u];
    param_9 = _e69;
    let _e70 = apow((&param_8), (&param_9));
    return vec3<f32>(_e60, _e65, _e70);
}

fn smooth_mix(a_3: ptr<function, f32>, b_3: ptr<function, f32>, c: ptr<function, f32>) -> f32 {
    var param_10: f32;
    var param_11: f32;

    let _e53 = (*a_3);
    let _e54 = (*b_3);
    let _e55 = (*c);
    param_10 = _e55;
    param_11 = 2f;
    let _e56 = sigmoid((&param_10), (&param_11));
    return mix(_e53, _e54, _e56);
}

fn random(co_1: ptr<function, vec2<f32>>, shft: ptr<function, f32>) -> f32 {
    var param_12: f32;
    var param_13: f32;
    var param_14: f32;

    let _e53 = (*co_1);
    (*co_1) = (_e53 + vec2(10f));
    let _e56 = (*co_1);
    let _e57 = (*shft);
    let _e62 = uniforms.Seed;
    let _e69 = (*co_1);
    let _e70 = (*shft);
    let _e76 = uniforms.Seed;
    let _e83 = (*shft);
    param_12 = fract((sin(dot(_e56, vec2<f32>((12.9898f + (floor(_e57) * 0.5f)), (78.233f + _e62)))) * 43758.547f));
    param_13 = fract((sin(dot(_e69, vec2<f32>((12.9898f + (floor((_e70 + 1f)) * 0.5f)), (78.233f + _e76)))) * 43758.547f));
    param_14 = fract(_e83);
    let _e85 = smooth_mix((&param_12), (&param_13), (&param_14));
    return _e85;
}

fn smooth_random(co_2: ptr<function, vec2<f32>>, shft_1: ptr<function, f32>) -> f32 {
    var param_15: vec2<f32>;
    var param_16: f32;
    var param_17: vec2<f32>;
    var param_18: f32;
    var param_19: f32;
    var param_20: f32;
    var param_21: f32;
    var param_22: vec2<f32>;
    var param_23: f32;
    var param_24: vec2<f32>;
    var param_25: f32;
    var param_26: f32;
    var param_27: f32;
    var param_28: f32;
    var param_29: f32;
    var param_30: f32;
    var param_31: f32;

    let _e67 = (*co_2);
    param_15 = floor(_e67);
    let _e69 = (*shft_1);
    param_16 = _e69;
    let _e70 = random((&param_15), (&param_16));
    let _e71 = (*co_2);
    param_17 = floor((_e71 + vec2<f32>(1f, 0f)));
    let _e74 = (*shft_1);
    param_18 = _e74;
    let _e75 = random((&param_17), (&param_18));
    let _e77 = (*co_2)[0u];
    param_19 = _e70;
    param_20 = _e75;
    param_21 = fract(_e77);
    let _e79 = smooth_mix((&param_19), (&param_20), (&param_21));
    let _e80 = (*co_2);
    param_22 = floor((_e80 + vec2<f32>(0f, 1f)));
    let _e83 = (*shft_1);
    param_23 = _e83;
    let _e84 = random((&param_22), (&param_23));
    let _e85 = (*co_2);
    param_24 = floor((_e85 + vec2<f32>(1f, 1f)));
    let _e88 = (*shft_1);
    param_25 = _e88;
    let _e89 = random((&param_24), (&param_25));
    let _e91 = (*co_2)[0u];
    param_26 = _e84;
    param_27 = _e89;
    param_28 = fract(_e91);
    let _e93 = smooth_mix((&param_26), (&param_27), (&param_28));
    let _e95 = (*co_2)[1u];
    param_29 = _e79;
    param_30 = _e93;
    param_31 = fract(_e95);
    let _e97 = smooth_mix((&param_29), (&param_30), (&param_31));
    return _e97;
}

fn rand_u0028_f1_u003b(co_3: ptr<function, f32>) -> f32 {
    let _e49 = (*co_3);
    let _e52 = uniforms.Seed;
    return fract((sin(((_e49 * 24.9898f) + _e52)) * 43758.547f));
}

fn transition(p_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var f: vec3<f32>;
    var i: f32;
    var param_32: f32;
    var param_33: f32;
    var param_34: f32;
    var param_35: f32;
    var param_36: vec2<f32>;
    var param_37: f32;
    var param_38: vec2<f32>;
    var param_39: f32;
    var param_40: f32;
    var param_41: vec3<f32>;
    var param_42: vec3<f32>;
    var param_43: vec2<f32>;
    var param_44: f32;
    var blurred_image: vec4<f32>;
    var bluramount: f32;
    var i_1: f32;
    var q: vec2<f32>;
    var param_45: vec2<f32>;
    var uv2_: vec2<f32>;
    var param_46: vec2<f32>;

    f = vec3<f32>(0f, 0f, 0f);
    i = 0f;
    loop {
        let _e71 = i;
        if (_e71 < 13f) {
            let _e74 = (*p_1)[0u];
            let _e75 = i;
            param_32 = _e75;
            let _e76 = rand_u0028_f1_u003b((&param_32));
            let _e80 = uniforms.progress;
            let _e83 = i;
            param_33 = (_e83 + 1.43f);
            let _e85 = rand_u0028_f1_u003b((&param_33));
            let _e89 = (*p_1)[1u];
            let _e90 = i;
            param_34 = (_e90 + 4.4f);
            let _e92 = rand_u0028_f1_u003b((&param_34));
            let _e96 = uniforms.progress;
            let _e99 = i;
            param_35 = (_e99 + 2.4f);
            let _e101 = rand_u0028_f1_u003b((&param_35));
            let _e105 = f;
            f = (_e105 + vec3((sin(((((_e74 * _e76) * 6f) + (_e80 * 8f)) + _e85)) * sin(((((_e89 * _e92) * 6f) + (_e96 * 6f)) + _e101)))));
            let _e108 = (*p_1);
            let _e110 = uniforms.progress;
            let _e113 = i;
            param_36 = vec2((_e110 * 1.3f));
            param_37 = (_e113 + 1f);
            let _e115 = smooth_random((&param_36), (&param_37));
            let _e117 = uniforms.progress;
            let _e120 = i;
            param_38 = vec2((_e117 * 0.5f));
            param_39 = (_e120 + 6.25f);
            let _e122 = smooth_random((&param_38), (&param_39));
            let _e126 = i;
            param_40 = _e126;
            let _e127 = rand_u0028_f1_u003b((&param_40));
            let _e132 = f;
            f = (_e132 + vec3((1f - clamp((length((_e108 - vec2<f32>(_e115, _e122))) * mix(20f, 70f, _e127)), 0f, 1f))));
            continue;
        } else {
            break;
        }
        continuing {
            let _e135 = i;
            i = (_e135 + 1f);
        }
    }
    let _e137 = f;
    f = (_e137 + vec3(4f));
    let _e140 = f;
    f = (_e140 / vec3(11f));
    let _e143 = f;
    let _e146 = uniforms.progress;
    param_41 = (_e143 * vec3<f32>(1f, 0.7f, 0.6f));
    param_42 = vec3<f32>(1f, (2f - sin((_e146 * 3.1415927f))), 1.3f);
    let _e151 = pow3((&param_41), (&param_42));
    f = _e151;
    let _e153 = uniforms.progress;
    let _e156 = f;
    f = (_e156 * sin((_e153 * 3.1415927f)));
    let _e158 = (*p_1);
    (*p_1) = (_e158 - vec2(0.5f));
    let _e162 = uniforms.progress;
    param_43 = vec2((_e162 * 5f));
    param_44 = 6.3f;
    let _e165 = smooth_random((&param_43), (&param_44));
    let _e167 = uniforms.progress;
    let _e173 = (*p_1);
    (*p_1) = (_e173 * (1f + ((_e165 * sin((_e167 * 3.1415927f))) * 0.05f)));
    let _e175 = (*p_1);
    (*p_1) = (_e175 + vec2(0.5f));
    blurred_image = vec4<f32>(0f, 0f, 0f, 0f);
    let _e179 = uniforms.progress;
    bluramount = (sin((_e179 * 3.1415927f)) * 0.03f);
    i_1 = 0f;
    loop {
        let _e183 = i_1;
        if (_e183 < 50f) {
            let _e185 = i_1;
            let _e190 = i_1;
            let _e196 = i_1;
            let _e198 = (*p_1)[0u];
            let _e200 = (*p_1)[1u];
            param_45 = vec2<f32>(_e196, (_e198 + _e200));
            let _e203 = rand_u0028_vf2_u003b((&param_45));
            let _e204 = bluramount;
            q = (vec2<f32>(cos(degrees(((_e185 / 50f) * 360f))), sin(degrees(((_e190 / 50f) * 360f)))) * (_e203 + _e204));
            let _e207 = (*p_1);
            let _e208 = q;
            let _e209 = bluramount;
            uv2_ = (_e207 + (_e208 * _e209));
            let _e212 = uv2_;
            param_46 = _e212;
            let _e213 = blendedColor((&param_46));
            let _e214 = blurred_image;
            blurred_image = (_e214 + _e213);
            continue;
        } else {
            break;
        }
        continuing {
            let _e216 = i_1;
            i_1 = (_e216 + 1f);
        }
    }
    let _e218 = blurred_image;
    blurred_image = (_e218 / vec4(50f));
    let _e221 = blurred_image;
    let _e222 = f;
    return (_e221 + vec4<f32>(_e222.x, _e222.y, _e222.z, 0f));
}

fn main_1() {
    var param_47: vec2<f32>;

    let _e49 = _uv_1;
    param_47 = _e49;
    let _e50 = transition((&param_47));
    _fragColor = _e50;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
