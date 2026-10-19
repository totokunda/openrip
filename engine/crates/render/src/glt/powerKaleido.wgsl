// powerKaleido — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/powerKaleido.glsl
// Author: Boundless
// License: MIT
// Description: The image folds into an animated kaleidoscope before revealing the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    scale: f32,
    z: f32,
    speed: f32,
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

fn refl(p: ptr<function, vec2<f32>>, o: ptr<function, vec2<f32>>, n: ptr<function, vec2<f32>>) -> vec2<f32> {
    let _e29 = (*o);
    let _e31 = (*n);
    let _e33 = (*p);
    let _e34 = (*o);
    let _e36 = (*n);
    let _e40 = (*p);
    return (((_e29 * 2f) + ((_e31 * 2f) * dot((_e33 - _e34), _e36))) - _e40);
}

fn rot(p_1: ptr<function, vec2<f32>>, o_1: ptr<function, vec2<f32>>, a: ptr<function, f32>) -> vec2<f32> {
    var s: f32;
    var c: f32;

    let _e31 = (*a);
    s = sin(_e31);
    let _e33 = (*a);
    c = cos(_e33);
    let _e35 = (*o_1);
    let _e36 = c;
    let _e37 = s;
    let _e39 = s;
    let _e40 = c;
    let _e44 = (*p_1);
    let _e45 = (*o_1);
    return (_e35 + (mat2x2<f32>(vec2<f32>(_e36, -(_e37)), vec2<f32>(_e39, _e40)) * (_e44 - _e45)));
}

fn mainImage(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var dist: f32;
    var uv0_: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: f32;
    var theta: f32;
    var iter: i32;
    var i: f32;
    var ts: f32;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: f32;
    var uvMix: vec2<f32>;
    var color: vec4<f32>;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;
    var phi_209_: bool;
    var phi_235_: bool;
    var phi_236_: bool;

    let _e47 = uniforms.scale;
    dist = (_e47 / 10f);
    let _e49 = (*uv_2);
    uv0_ = _e49;
    let _e50 = (*uv_2);
    (*uv_2) = (_e50 - vec2(0.5f));
    let _e54 = uniforms.ratio;
    let _e56 = (*uv_2)[0u];
    (*uv_2)[0u] = (_e56 * _e54);
    let _e60 = uniforms.z;
    let _e61 = (*uv_2);
    (*uv_2) = (_e61 * _e60);
    let _e64 = uniforms.progress;
    let _e66 = uniforms.speed;
    let _e68 = (*uv_2);
    param = _e68;
    param_1 = vec2<f32>(0f, 0f);
    param_2 = (_e64 * _e66);
    let _e69 = rot((&param), (&param_1), (&param_2));
    (*uv_2) = _e69;
    let _e71 = uniforms.progress;
    theta = ((_e71 * 6f) + 6.2831855f);
    iter = 0i;
    loop {
        let _e74 = iter;
        if (_e74 < 10i) {
            i = 0f;
            loop {
                let _e76 = i;
                if (_e76 < 6.2831855f) {
                    let _e78 = i;
                    ts = select(0f, 1f, (sign(asin(cos(_e78))) == 1f));
                    let _e84 = ts;
                    let _e85 = (_e84 == 1f);
                    phi_209_ = _e85;
                    if _e85 {
                        let _e87 = (*uv_2)[1u];
                        let _e88 = dist;
                        let _e89 = i;
                        let _e93 = i;
                        let _e96 = (*uv_2)[0u];
                        let _e97 = dist;
                        let _e98 = i;
                        phi_209_ = ((_e87 - (_e88 * cos(_e89))) > (tan(_e93) * (_e96 + (_e97 * sin(_e98)))));
                    }
                    let _e105 = phi_209_;
                    phi_236_ = _e105;
                    if !(_e105) {
                        let _e107 = ts;
                        let _e108 = (_e107 == 0f);
                        phi_235_ = _e108;
                        if _e108 {
                            let _e110 = (*uv_2)[1u];
                            let _e111 = dist;
                            let _e112 = i;
                            let _e116 = i;
                            let _e119 = (*uv_2)[0u];
                            let _e120 = dist;
                            let _e121 = i;
                            phi_235_ = ((_e110 - (_e111 * cos(_e112))) < (tan(_e116) * (_e119 + (_e120 * sin(_e121)))));
                        }
                        let _e128 = phi_235_;
                        phi_236_ = _e128;
                    }
                    let _e130 = phi_236_;
                    if _e130 {
                        let _e132 = (*uv_2)[0u];
                        let _e133 = i;
                        let _e135 = dist;
                        let _e140 = (*uv_2)[1u];
                        let _e141 = i;
                        let _e143 = dist;
                        let _e148 = i;
                        let _e150 = i;
                        param_3 = vec2<f32>((_e132 + ((sin(_e133) * _e135) * 2f)), (_e140 - ((cos(_e141) * _e143) * 2f)));
                        param_4 = vec2<f32>(0f, 0f);
                        param_5 = vec2<f32>(cos(_e148), sin(_e150));
                        let _e153 = refl((&param_3), (&param_4), (&param_5));
                        (*uv_2) = _e153;
                    }
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e154 = i;
                    i = (_e154 + 2.0943952f);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e156 = iter;
            iter = (_e156 + 1i);
        }
    }
    let _e158 = (*uv_2);
    (*uv_2) = (_e158 + vec2(0.5f));
    let _e162 = uniforms.progress;
    let _e164 = uniforms.speed;
    let _e167 = (*uv_2);
    param_6 = _e167;
    param_7 = vec2<f32>(0.5f, 0.5f);
    param_8 = (_e162 * -(_e164));
    let _e168 = rot((&param_6), (&param_7), (&param_8));
    (*uv_2) = _e168;
    let _e169 = (*uv_2);
    (*uv_2) = (_e169 - vec2(0.5f));
    let _e173 = uniforms.ratio;
    let _e175 = (*uv_2)[0u];
    (*uv_2)[0u] = (_e175 / _e173);
    let _e178 = (*uv_2);
    (*uv_2) = (_e178 + vec2(0.5f));
    let _e181 = (*uv_2);
    let _e184 = (*uv_2);
    (*uv_2) = (abs(((_e181 / vec2(2f)) - floor(((_e184 / vec2(2f)) + vec2(0.5f))))) * 2f);
    let _e193 = (*uv_2);
    let _e194 = uv0_;
    let _e196 = uniforms.progress;
    uvMix = mix(_e193, _e194, vec2(((cos(((_e196 * 3.1415927f) * 2f)) / 2f) + 0.5f)));
    let _e204 = uvMix;
    param_9 = _e204;
    let _e205 = getFromColor((&param_9));
    let _e206 = uvMix;
    param_10 = _e206;
    let _e207 = getToColor((&param_10));
    let _e209 = uniforms.progress;
    color = mix(_e205, _e207, vec4(((cos(((_e209 - 1f) * 3.1415927f)) / 2f) + 0.5f)));
    let _e217 = color;
    return _e217;
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var color_1: vec4<f32>;
    var param_11: vec2<f32>;

    let _e29 = (*uv_3);
    param_11 = _e29;
    let _e30 = mainImage((&param_11));
    color_1 = _e30;
    let _e31 = color_1;
    return _e31;
}

fn main_1() {
    var param_12: vec2<f32>;

    let _e27 = _uv_1;
    param_12 = _e27;
    let _e28 = transition((&param_12));
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
