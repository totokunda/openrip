// fragment — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/fragment.glsl
// Author: lbl
// License: MIT
// Description: The outgoing image shatters into fragments that fly away
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

fn random(par: ptr<function, vec2<f32>>) -> f32 {
    let _e25 = (*par);
    return fract((sin(dot(_e25, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn random2(par_1: ptr<function, vec2<f32>>) -> vec2<f32> {
    var rand: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e28 = (*par_1);
    param = _e28;
    let _e29 = random((&param));
    rand = _e29;
    let _e30 = rand;
    let _e31 = (*par_1);
    let _e32 = rand;
    param_1 = (_e31 + vec2(_e32));
    let _e35 = random((&param_1));
    return vec2<f32>(_e30, _e35);
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e26 = (*uv)[0u];
    let _e28 = (*uv)[1u];
    let _e31 = textureSampleLevel(_to, _sampler, vec2<f32>(_e26, (1f - _e28)), 0f);
    return _e31;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e26 = (*uv_1)[0u];
    let _e28 = (*uv_1)[1u];
    let _e31 = textureSampleLevel(_from, _sampler, vec2<f32>(_e26, (1f - _e28)), 0f);
    return _e31;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var time: f32;
    var i: i32;
    var point: array<vec2<f32>, 10>;
    var param_4: vec2<f32>;
    var col: vec4<f32>;
    var param_5: vec2<f32>;
    var i_1: i32;
    var dir: vec2<f32>;
    var param_6: vec2<f32>;
    var v: f32;
    var param_7: vec2<f32>;
    var ofst: vec2<f32>;
    var U: vec2<f32>;
    var dist_i: f32;
    var closest: bool;
    var j: i32;
    var param_8: vec2<f32>;
    var phi_199_: bool;
    var phi_206_: bool;
    var phi_213_: bool;

    let _e45 = uniforms.progress;
    if (_e45 <= 0f) {
        let _e47 = (*uv_2);
        param_2 = _e47;
        let _e48 = getFromColor((&param_2));
        return _e48;
    }
    let _e50 = uniforms.progress;
    if (_e50 >= 1f) {
        let _e52 = (*uv_2);
        param_3 = _e52;
        let _e53 = getToColor((&param_3));
        return _e53;
    }
    let _e55 = uniforms.progress;
    time = (_e55 * 8f);
    i = 0i;
    loop {
        let _e57 = i;
        if (_e57 < 10i) {
            let _e59 = i;
            let _e60 = i;
            param_4 = vec2(f32(_e60));
            let _e63 = random2((&param_4));
            point[_e59] = _e63;
            continue;
        } else {
            break;
        }
        continuing {
            let _e65 = i;
            i = (_e65 + 1i);
        }
    }
    let _e67 = (*uv_2);
    param_5 = _e67;
    let _e68 = getToColor((&param_5));
    col = _e68;
    i_1 = 0i;
    loop {
        let _e69 = i_1;
        if (_e69 < 10i) {
            let _e71 = i_1;
            let _e73 = i_1;
            param_6 = vec2<f32>(f32(_e71), (f32(_e73) + 11f));
            let _e77 = random2((&param_6));
            dir = normalize(_e77);
            let _e79 = dir;
            param_7 = _e79;
            let _e80 = random((&param_7));
            v = ((1f + (_e80 * 0.5f)) * 0.2f);
            let _e84 = dir;
            let _e85 = time;
            let _e89 = v;
            ofst = ((_e84 * clamp((_e85 - 0.5f), 0f, 8f)) * _e89);
            let _e91 = (*uv_2);
            let _e92 = ofst;
            U = (_e91 - _e92);
            let _e95 = U[0u];
            let _e96 = (_e95 < 0f);
            phi_199_ = _e96;
            if !(_e96) {
                let _e99 = U[0u];
                phi_199_ = (_e99 > 1f);
            }
            let _e102 = phi_199_;
            phi_206_ = _e102;
            if !(_e102) {
                let _e105 = U[1u];
                phi_206_ = (_e105 < 0f);
            }
            let _e108 = phi_206_;
            phi_213_ = _e108;
            if !(_e108) {
                let _e111 = U[1u];
                phi_213_ = (_e111 > 1f);
            }
            let _e114 = phi_213_;
            if _e114 {
                continue;
            }
            let _e115 = U;
            let _e116 = i_1;
            let _e118 = point[_e116];
            dist_i = distance(_e115, _e118);
            closest = true;
            j = 0i;
            loop {
                let _e120 = j;
                if (_e120 < 10i) {
                    let _e122 = U;
                    let _e123 = j;
                    let _e125 = point[_e123];
                    let _e127 = dist_i;
                    if (distance(_e122, _e125) < _e127) {
                        closest = false;
                        break;
                    }
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e129 = j;
                    j = (_e129 + 1i);
                }
            }
            let _e131 = closest;
            if _e131 {
                let _e132 = U;
                param_8 = _e132;
                let _e133 = getFromColor((&param_8));
                col = _e133;
                break;
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e134 = i_1;
            i_1 = (_e134 + 1i);
        }
    }
    let _e136 = col;
    return _e136;
}

fn main_1() {
    var param_9: vec2<f32>;

    let _e25 = _uv_1;
    param_9 = _e25;
    let _e26 = transition((&param_9));
    _fragColor = _e26;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
