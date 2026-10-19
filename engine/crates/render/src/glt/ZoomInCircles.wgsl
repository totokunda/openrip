// ZoomInCircles — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/ZoomInCircles.glsl
// Author: dycm8009
// License: MIT
// Description: Concentric rings of the outgoing image zoom at different speeds before revealing the incoming one
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

fn zoom(uv_2: ptr<function, vec2<f32>>, amount: ptr<function, f32>) -> vec2<f32> {
    let _e25 = (*uv_2);
    let _e28 = (*amount);
    return (vec2(0.5f) + ((_e25 - vec2(0.5f)) * _e28));
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var ratio2_: vec2<f32>;
    var r: vec2<f32>;
    var pro: f32;
    var z: f32;
    var t: f32;
    var param: vec2<f32>;
    var param_1: f32;
    var param_2: vec2<f32>;
    var param_3: f32;
    var param_4: vec2<f32>;
    var param_5: f32;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;

    let _e38 = uniforms.ratio;
    ratio2_ = vec2<f32>(1f, (1f / _e38));
    let _e41 = (*uv_3);
    let _e44 = ratio2_;
    r = (((_e41 - vec2(0.5f)) * _e44) * 2f);
    let _e48 = uniforms.progress;
    pro = (_e48 / 0.8f);
    let _e50 = pro;
    z = (_e50 * 0.2f);
    t = 0f;
    let _e52 = pro;
    if (_e52 > 1f) {
        let _e54 = pro;
        z = (0.2f + ((_e54 - 1f) * 5f));
        let _e59 = uniforms.progress;
        t = clamp(((_e59 - 0.8f) / 0.07f), 0f, 1f);
    }
    let _e63 = r;
    let _e65 = z;
    if (length(_e63) < (0.5f + _e65)) {
    } else {
        let _e68 = r;
        let _e70 = z;
        if (length(_e68) < (0.8f + (_e70 * 1.5f))) {
            let _e74 = pro;
            let _e77 = (*uv_3);
            param = _e77;
            param_1 = (1f - (0.15f * _e74));
            let _e78 = zoom((&param), (&param_1));
            (*uv_3) = _e78;
            let _e79 = t;
            t = (_e79 * 0.5f);
        } else {
            let _e81 = r;
            let _e83 = z;
            if (length(_e81) < (1.2f + (_e83 * 2.5f))) {
                let _e87 = pro;
                let _e90 = (*uv_3);
                param_2 = _e90;
                param_3 = (1f - (0.2f * _e87));
                let _e91 = zoom((&param_2), (&param_3));
                (*uv_3) = _e91;
                let _e92 = t;
                t = (_e92 * 0.2f);
            } else {
                let _e94 = pro;
                let _e97 = (*uv_3);
                param_4 = _e97;
                param_5 = (1f - (0.25f * _e94));
                let _e98 = zoom((&param_4), (&param_5));
                (*uv_3) = _e98;
            }
        }
    }
    let _e99 = (*uv_3);
    param_6 = _e99;
    let _e100 = getFromColor((&param_6));
    let _e101 = (*uv_3);
    param_7 = _e101;
    let _e102 = getToColor((&param_7));
    let _e103 = t;
    return mix(_e100, _e102, vec4(_e103));
}

fn main_1() {
    var param_8: vec2<f32>;

    let _e24 = _uv_1;
    param_8 = _e24;
    let _e25 = transition((&param_8));
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
