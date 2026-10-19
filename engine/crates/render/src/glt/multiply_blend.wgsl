// multiply_blend — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/multiply_blend.glsl
// Author: Fernando Kuteken
// License: MIT
// Description: A crossfade through the multiplied blend of both images
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

fn blend(a: ptr<function, vec4<f32>>, b: ptr<function, vec4<f32>>) -> vec4<f32> {
    let _e15 = (*a);
    let _e16 = (*b);
    return (_e15 * _e16);
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e15 = (*uv)[0u];
    let _e17 = (*uv)[1u];
    let _e20 = textureSampleLevel(_to, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e15 = (*uv_1)[0u];
    let _e17 = (*uv_1)[1u];
    let _e20 = textureSampleLevel(_from, _sampler, vec2<f32>(_e15, (1f - _e17)), 0f);
    return _e20;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var blended: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec4<f32>;
    var param_3: vec4<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;

    let _e21 = (*uv_2);
    param = _e21;
    let _e22 = getFromColor((&param));
    let _e23 = (*uv_2);
    param_1 = _e23;
    let _e24 = getToColor((&param_1));
    param_2 = _e22;
    param_3 = _e24;
    let _e25 = blend((&param_2), (&param_3));
    blended = _e25;
    let _e27 = uniforms.progress;
    if (_e27 < 0.5f) {
        let _e29 = (*uv_2);
        param_4 = _e29;
        let _e30 = getFromColor((&param_4));
        let _e31 = blended;
        let _e33 = uniforms.progress;
        return mix(_e30, _e31, vec4((2f * _e33)));
    } else {
        let _e37 = blended;
        let _e38 = (*uv_2);
        param_5 = _e38;
        let _e39 = getToColor((&param_5));
        let _e41 = uniforms.progress;
        return mix(_e37, _e39, vec4(((2f * _e41) - 1f)));
    }
}

fn main_1() {
    var param_6: vec2<f32>;

    let _e14 = _uv_1;
    param_6 = _e14;
    let _e15 = transition((&param_6));
    _fragColor = _e15;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
