// tangentMotionBlur — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/tangentMotionBlur.glsl
// Author: chenkai
// License: MIT
// Description: The outgoing image is flung away along a curve with motion blur
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
    let _e36 = (*uv)[0u];
    let _e38 = (*uv)[1u];
    let _e41 = textureSampleLevel(_to, _sampler, vec2<f32>(_e36, (1f - _e38)), 0f);
    return _e41;
}

fn rand(co: ptr<function, vec2<f32>>) -> f32 {
    let _e35 = (*co);
    return fract((sin(dot(_e35, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn motionBlurTo(_st: ptr<function, vec2<f32>>, speed: ptr<function, vec2<f32>>) -> vec4<f32> {
    var texCoord: vec2<f32>;
    var color: vec3<f32>;
    var total: f32;
    var offset: f32;
    var param: vec2<f32>;
    var t: f32;
    var percent: f32;
    var weight: f32;
    var newuv: vec2<f32>;
    var param_1: vec2<f32>;

    let _e46 = (*_st);
    texCoord = (_e46 / vec2<f32>(1f, 1f));
    color = vec3<f32>(0f, 0f, 0f);
    total = 0f;
    let _e48 = (*_st);
    param = _e48;
    let _e49 = rand((&param));
    offset = _e49;
    t = 0f;
    loop {
        let _e50 = t;
        if (_e50 <= 20f) {
            let _e52 = t;
            let _e53 = offset;
            percent = ((_e52 + _e53) / 20f);
            let _e56 = percent;
            let _e57 = percent;
            let _e58 = percent;
            weight = (4f * (_e56 - (_e57 * _e58)));
            let _e62 = texCoord;
            let _e63 = (*speed);
            let _e64 = percent;
            newuv = (_e62 + (_e63 * _e64));
            let _e67 = newuv;
            newuv = fract(_e67);
            let _e69 = newuv;
            param_1 = _e69;
            let _e70 = getToColor((&param_1));
            let _e72 = weight;
            let _e74 = color;
            color = (_e74 + (_e70.xyz * _e72));
            let _e76 = weight;
            let _e77 = total;
            total = (_e77 + _e76);
            continue;
        } else {
            break;
        }
        continuing {
            let _e79 = t;
            t = (_e79 + 1f);
        }
    }
    let _e81 = color;
    let _e82 = total;
    let _e84 = (_e81 / vec3(_e82));
    return vec4<f32>(_e84.x, _e84.y, _e84.z, 1f);
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e36 = (*uv_1)[0u];
    let _e38 = (*uv_1)[1u];
    let _e41 = textureSampleLevel(_from, _sampler, vec2<f32>(_e36, (1f - _e38)), 0f);
    return _e41;
}

fn motionBlurFrom(_st_1: ptr<function, vec2<f32>>, speed_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var texCoord_1: vec2<f32>;
    var color_1: vec3<f32>;
    var total_1: f32;
    var offset_1: f32;
    var param_2: vec2<f32>;
    var t_1: f32;
    var percent_1: f32;
    var weight_1: f32;
    var newuv_1: vec2<f32>;
    var param_3: vec2<f32>;

    let _e46 = (*_st_1);
    texCoord_1 = (_e46 / vec2<f32>(1f, 1f));
    color_1 = vec3<f32>(0f, 0f, 0f);
    total_1 = 0f;
    let _e48 = (*_st_1);
    param_2 = _e48;
    let _e49 = rand((&param_2));
    offset_1 = _e49;
    t_1 = 0f;
    loop {
        let _e50 = t_1;
        if (_e50 <= 20f) {
            let _e52 = t_1;
            let _e53 = offset_1;
            percent_1 = ((_e52 + _e53) / 20f);
            let _e56 = percent_1;
            let _e57 = percent_1;
            let _e58 = percent_1;
            weight_1 = (4f * (_e56 - (_e57 * _e58)));
            let _e62 = texCoord_1;
            let _e63 = (*speed_1);
            let _e64 = percent_1;
            newuv_1 = (_e62 + (_e63 * _e64));
            let _e67 = newuv_1;
            newuv_1 = fract(_e67);
            let _e69 = newuv_1;
            param_3 = _e69;
            let _e70 = getFromColor((&param_3));
            let _e72 = weight_1;
            let _e74 = color_1;
            color_1 = (_e74 + (_e70.xyz * _e72));
            let _e76 = weight_1;
            let _e77 = total_1;
            total_1 = (_e77 + _e76);
            continue;
        } else {
            break;
        }
        continuing {
            let _e79 = t_1;
            t_1 = (_e79 + 1f);
        }
    }
    let _e81 = color_1;
    let _e82 = total_1;
    let _e84 = (_e81 / vec3(_e82));
    return vec4<f32>(_e84.x, _e84.y, _e84.z, 1f);
}

fn rotateUv(uv_2: ptr<function, vec2<f32>>, angle: ptr<function, f32>, anchor: ptr<function, vec2<f32>>, zDirection: ptr<function, f32>) -> vec2<f32> {
    var s: f32;
    var c: f32;
    var m: mat2x2<f32>;

    let _e41 = (*uv_2);
    let _e42 = (*anchor);
    (*uv_2) = (_e41 - _e42);
    let _e44 = (*angle);
    s = sin(_e44);
    let _e46 = (*angle);
    c = cos(_e46);
    let _e48 = c;
    let _e49 = s;
    let _e51 = s;
    let _e52 = c;
    m = mat2x2<f32>(vec2<f32>(_e48, -(_e49)), vec2<f32>(_e51, _e52));
    let _e56 = m;
    let _e57 = (*uv_2);
    (*uv_2) = (_e56 * _e57);
    let _e59 = (*anchor);
    let _e60 = (*uv_2);
    (*uv_2) = (_e60 + _e59);
    let _e62 = (*uv_2);
    return _e62;
}

fn normpdf(x: ptr<function, f32>) -> f32 {
    var d: f32;

    let _e36 = (*x);
    d = (_e36 - 0.5f);
    let _e38 = d;
    let _e40 = d;
    return exp(((-20f * _e38) * _e40));
}

fn C(aA1_: ptr<function, f32>) -> f32 {
    let _e35 = (*aA1_);
    return (3f * _e35);
}

fn B(aA1_1: ptr<function, f32>, aA2_: ptr<function, f32>) -> f32 {
    let _e36 = (*aA2_);
    let _e38 = (*aA1_1);
    return ((3f * _e36) - (6f * _e38));
}

fn A(aA1_2: ptr<function, f32>, aA2_1: ptr<function, f32>) -> f32 {
    let _e36 = (*aA2_1);
    let _e39 = (*aA1_2);
    return ((1f - (3f * _e36)) + (3f * _e39));
}

fn CalcBezier(aT: ptr<function, f32>, aA1_3: ptr<function, f32>, aA2_2: ptr<function, f32>) -> f32 {
    var param_4: f32;
    var param_5: f32;
    var param_6: f32;
    var param_7: f32;
    var param_8: f32;

    let _e42 = (*aA1_3);
    param_4 = _e42;
    let _e43 = (*aA2_2);
    param_5 = _e43;
    let _e44 = A((&param_4), (&param_5));
    let _e45 = (*aT);
    let _e47 = (*aA1_3);
    param_6 = _e47;
    let _e48 = (*aA2_2);
    param_7 = _e48;
    let _e49 = B((&param_6), (&param_7));
    let _e51 = (*aT);
    let _e53 = (*aA1_3);
    param_8 = _e53;
    let _e54 = C((&param_8));
    let _e56 = (*aT);
    return (((((_e44 * _e45) + _e49) * _e51) + _e54) * _e56);
}

fn GetSlope(aT_1: ptr<function, f32>, aA1_4: ptr<function, f32>, aA2_3: ptr<function, f32>) -> f32 {
    var param_9: f32;
    var param_10: f32;
    var param_11: f32;
    var param_12: f32;
    var param_13: f32;

    let _e42 = (*aA1_4);
    param_9 = _e42;
    let _e43 = (*aA2_3);
    param_10 = _e43;
    let _e44 = A((&param_9), (&param_10));
    let _e46 = (*aT_1);
    let _e48 = (*aT_1);
    let _e50 = (*aA1_4);
    param_11 = _e50;
    let _e51 = (*aA2_3);
    param_12 = _e51;
    let _e52 = B((&param_11), (&param_12));
    let _e54 = (*aT_1);
    let _e57 = (*aA1_4);
    param_13 = _e57;
    let _e58 = C((&param_13));
    return (((((3f * _e44) * _e46) * _e48) + ((2f * _e52) * _e54)) + _e58);
}

fn GetTForX(aX: ptr<function, f32>, mX1_: ptr<function, f32>, mX2_: ptr<function, f32>) -> f32 {
    var aGuessT: f32;
    var i: i32;
    var currentSlope: f32;
    var param_14: f32;
    var param_15: f32;
    var param_16: f32;
    var currentX: f32;
    var param_17: f32;
    var param_18: f32;
    var param_19: f32;

    let _e47 = (*aX);
    aGuessT = _e47;
    i = 0i;
    loop {
        let _e48 = i;
        if (_e48 < 4i) {
            let _e50 = aGuessT;
            param_14 = _e50;
            let _e51 = (*mX1_);
            param_15 = _e51;
            let _e52 = (*mX2_);
            param_16 = _e52;
            let _e53 = GetSlope((&param_14), (&param_15), (&param_16));
            currentSlope = _e53;
            let _e54 = currentSlope;
            if (_e54 == 0f) {
                let _e56 = aGuessT;
                return _e56;
            }
            let _e57 = aGuessT;
            param_17 = _e57;
            let _e58 = (*mX1_);
            param_18 = _e58;
            let _e59 = (*mX2_);
            param_19 = _e59;
            let _e60 = CalcBezier((&param_17), (&param_18), (&param_19));
            let _e61 = (*aX);
            currentX = (_e60 - _e61);
            let _e63 = currentX;
            let _e64 = currentSlope;
            let _e66 = aGuessT;
            aGuessT = (_e66 - (_e63 / _e64));
            continue;
        } else {
            break;
        }
        continuing {
            let _e68 = i;
            i = (_e68 + 1i);
        }
    }
    let _e70 = aGuessT;
    return _e70;
}

fn KeySpline(aX_1: ptr<function, f32>, mX1_1: ptr<function, f32>, mY1_: ptr<function, f32>, mX2_1: ptr<function, f32>, mY2_: ptr<function, f32>) -> f32 {
    var param_20: f32;
    var param_21: f32;
    var param_22: f32;
    var param_23: f32;
    var param_24: f32;
    var param_25: f32;

    let _e45 = (*mX1_1);
    let _e46 = (*mY1_);
    let _e48 = (*mX2_1);
    let _e49 = (*mY2_);
    if ((_e45 == _e46) && (_e48 == _e49)) {
        let _e52 = (*aX_1);
        return _e52;
    }
    let _e53 = (*aX_1);
    param_20 = _e53;
    let _e54 = (*mX1_1);
    param_21 = _e54;
    let _e55 = (*mX2_1);
    param_22 = _e55;
    let _e56 = GetTForX((&param_20), (&param_21), (&param_22));
    param_23 = _e56;
    let _e57 = (*mY1_);
    param_24 = _e57;
    let _e58 = (*mY2_);
    param_25 = _e58;
    let _e59 = CalcBezier((&param_23), (&param_24), (&param_25));
    return _e59;
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var myst: vec2<f32>;
    var animationTime: f32;
    var easingTime: f32;
    var param_26: f32;
    var param_27: f32;
    var param_28: f32;
    var param_29: f32;
    var param_30: f32;
    var blur: f32;
    var param_31: f32;
    var r: f32;
    var rotation: f32;
    var mystCurrent: vec2<f32>;
    var param_32: vec2<f32>;
    var param_33: f32;
    var param_34: vec2<f32>;
    var param_35: f32;
    var timeInterval: f32;
    var mystNext: vec2<f32>;
    var param_36: vec2<f32>;
    var param_37: f32;
    var param_38: vec2<f32>;
    var param_39: f32;
    var speed_2: vec2<f32>;
    var param_40: vec2<f32>;
    var param_41: vec2<f32>;
    var param_42: vec2<f32>;
    var param_43: vec2<f32>;

    let _e63 = (*uv_3);
    myst = _e63;
    let _e65 = uniforms.progress;
    animationTime = _e65;
    let _e66 = animationTime;
    param_26 = _e66;
    param_27 = 0.68f;
    param_28 = 0.01f;
    param_29 = 0.17f;
    param_30 = 0.98f;
    let _e67 = KeySpline((&param_26), (&param_27), (&param_28), (&param_29), (&param_30));
    easingTime = _e67;
    let _e68 = easingTime;
    param_31 = _e68;
    let _e69 = normpdf((&param_31));
    blur = _e69;
    r = 0f;
    rotation = 3.14159f;
    let _e70 = easingTime;
    if (_e70 <= 0.5f) {
        let _e72 = rotation;
        let _e73 = easingTime;
        r = (_e72 * _e73);
    } else {
        let _e75 = rotation;
        let _e77 = rotation;
        let _e78 = easingTime;
        r = (-(_e75) + (_e77 * _e78));
    }
    let _e81 = myst;
    mystCurrent = _e81;
    let _e83 = uniforms.ratio;
    let _e86 = mystCurrent[1u];
    mystCurrent[1u] = (_e86 * (1f / _e83));
    let _e89 = mystCurrent;
    param_32 = _e89;
    let _e90 = r;
    param_33 = _e90;
    param_34 = vec2<f32>(1f, 0f);
    param_35 = -1f;
    let _e91 = rotateUv((&param_32), (&param_33), (&param_34), (&param_35));
    mystCurrent = _e91;
    let _e93 = uniforms.ratio;
    let _e95 = mystCurrent[1u];
    mystCurrent[1u] = (_e95 * _e93);
    timeInterval = 0.0334f;
    let _e98 = easingTime;
    if (_e98 <= 0.5f) {
        let _e100 = rotation;
        let _e101 = easingTime;
        let _e102 = timeInterval;
        r = (_e100 * (_e101 + _e102));
    } else {
        let _e105 = rotation;
        let _e107 = rotation;
        let _e108 = easingTime;
        let _e109 = timeInterval;
        r = (-(_e105) + (_e107 * (_e108 + _e109)));
    }
    let _e113 = myst;
    mystNext = _e113;
    let _e115 = uniforms.ratio;
    let _e118 = mystNext[1u];
    mystNext[1u] = (_e118 * (1f / _e115));
    let _e121 = mystNext;
    param_36 = _e121;
    let _e122 = r;
    param_37 = _e122;
    param_38 = vec2<f32>(1f, 0f);
    param_39 = -1f;
    let _e123 = rotateUv((&param_36), (&param_37), (&param_38), (&param_39));
    mystNext = _e123;
    let _e125 = uniforms.ratio;
    let _e127 = mystNext[1u];
    mystNext[1u] = (_e127 * _e125);
    let _e130 = mystNext;
    let _e131 = mystCurrent;
    let _e133 = timeInterval;
    let _e136 = blur;
    speed_2 = ((((_e130 - _e131) / vec2(_e133)) * _e136) * 0.5f);
    let _e139 = easingTime;
    if (_e139 <= 0.5f) {
        let _e141 = mystCurrent;
        param_40 = _e141;
        let _e142 = speed_2;
        param_41 = _e142;
        let _e143 = motionBlurFrom((&param_40), (&param_41));
        return _e143;
    } else {
        let _e144 = mystCurrent;
        param_42 = _e144;
        let _e145 = speed_2;
        param_43 = _e145;
        let _e146 = motionBlurTo((&param_42), (&param_43));
        return _e146;
    }
}

fn main_1() {
    var param_44: vec2<f32>;

    let _e35 = _uv_1;
    param_44 = _e35;
    let _e36 = transition((&param_44));
    _fragColor = _e36;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
