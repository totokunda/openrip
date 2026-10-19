// RectangleCrop — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/RectangleCrop.glsl
// Author: martiniti
// License: MIT
// Description: The outgoing image shrinks into a small rectangle over a background color, then the incoming one grows from it
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    bgcolor: vec4<f32>,
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
    var s: f32;
    var q: vec2<f32>;
    var bl: vec2<f32>;
    var tr: vec2<f32>;
    var dist: f32;
    var local: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e28 = uniforms.progress;
    s = pow((2f * abs((_e28 - 0.5f))), 3f);
    let _e33 = (*uv_2);
    q = (_e33 / vec2<f32>(1f, 1f));
    let _e36 = uniforms.progress;
    let _e42 = q;
    bl = step(vec2((1f - (2f * abs((_e36 - 0.5f))))), (_e42 + vec2(0.25f)));
    let _e47 = uniforms.progress;
    let _e53 = q;
    tr = step(vec2((1f - (2f * abs((_e47 - 0.5f))))), (vec2(1.25f) - _e53));
    let _e58 = bl[0u];
    let _e60 = bl[1u];
    let _e63 = tr[0u];
    let _e66 = tr[1u];
    dist = length((1f - (((_e58 * _e60) * _e63) * _e66)));
    let _e71 = uniforms.progress;
    if (_e71 < 0.5f) {
        let _e73 = (*uv_2);
        param = _e73;
        let _e74 = getFromColor((&param));
        local = _e74;
    } else {
        let _e75 = (*uv_2);
        param_1 = _e75;
        let _e76 = getToColor((&param_1));
        local = _e76;
    }
    let _e77 = local;
    let _e79 = uniforms.bgcolor;
    let _e80 = s;
    let _e81 = dist;
    return mix(_e77, _e79, vec4(step(_e80, _e81)));
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
