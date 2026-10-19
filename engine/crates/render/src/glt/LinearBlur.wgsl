// LinearBlur — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/LinearBlur.glsl
// Author: gre
// License: MIT
// Description: A crossfade through a blur
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    intensity: f32,
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
    let _e20 = (*uv)[0u];
    let _e22 = (*uv)[1u];
    let _e25 = textureSampleLevel(_to, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e20 = (*uv_1)[0u];
    let _e22 = (*uv_1)[1u];
    let _e25 = textureSampleLevel(_from, _sampler, vec2<f32>(_e20, (1f - _e22)), 0f);
    return _e25;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var c1_: vec4<f32>;
    var c2_: vec4<f32>;
    var disp: f32;
    var xi: i32;
    var x: f32;
    var yi: i32;
    var y: f32;
    var v: vec2<f32>;
    var d: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    c1_ = vec4<f32>(0f, 0f, 0f, 0f);
    c2_ = vec4<f32>(0f, 0f, 0f, 0f);
    let _e31 = uniforms.intensity;
    let _e33 = uniforms.progress;
    disp = (_e31 * (0.5f - distance(0.5f, _e33)));
    xi = 0i;
    loop {
        let _e37 = xi;
        if (_e37 < 6i) {
            let _e39 = xi;
            x = ((f32(_e39) / 6f) - 0.5f);
            yi = 0i;
            loop {
                let _e43 = yi;
                if (_e43 < 6i) {
                    let _e45 = yi;
                    y = ((f32(_e45) / 6f) - 0.5f);
                    let _e49 = x;
                    let _e50 = y;
                    v = vec2<f32>(_e49, _e50);
                    let _e52 = disp;
                    d = _e52;
                    let _e53 = (*uv_2);
                    let _e54 = d;
                    let _e55 = v;
                    param = (_e53 + (_e55 * _e54));
                    let _e58 = getFromColor((&param));
                    let _e59 = c1_;
                    c1_ = (_e59 + _e58);
                    let _e61 = (*uv_2);
                    let _e62 = d;
                    let _e63 = v;
                    param_1 = (_e61 + (_e63 * _e62));
                    let _e66 = getToColor((&param_1));
                    let _e67 = c2_;
                    c2_ = (_e67 + _e66);
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e69 = yi;
                    yi = (_e69 + 1i);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e71 = xi;
            xi = (_e71 + 1i);
        }
    }
    let _e73 = c1_;
    c1_ = (_e73 / vec4(36f));
    let _e76 = c2_;
    c2_ = (_e76 / vec4(36f));
    let _e79 = c1_;
    let _e80 = c2_;
    let _e82 = uniforms.progress;
    return mix(_e79, _e80, vec4(_e82));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e19 = _uv_1;
    param_2 = _e19;
    let _e20 = transition((&param_2));
    _fragColor = _e20;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
