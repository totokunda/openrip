// Rectangle — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Rectangle.glsl
// Author: martiniti
// License: MIT
// Description: A rectangle grows from the center to cover the outgoing image, then shrinks to reveal the incoming one
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

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var s: f32;
    var sq: vec2<f32>;
    var bl: vec2<f32>;
    var dist: f32;
    var tr: vec2<f32>;
    var local: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e28 = uniforms.progress;
    s = pow((2f * abs((_e28 - 0.5f))), 3f);
    let _e33 = (*p);
    sq = (_e33 / vec2<f32>(1f, 1f));
    let _e36 = uniforms.progress;
    let _e41 = sq;
    bl = step(vec2(abs((1f - (2f * _e36)))), (_e41 + vec2(0.25f)));
    let _e46 = bl[0u];
    let _e48 = bl[1u];
    dist = (_e46 * _e48);
    let _e51 = uniforms.progress;
    let _e56 = sq;
    tr = step(vec2(abs((1f - (2f * _e51)))), (vec2(1.25f) - _e56));
    let _e61 = tr[0u];
    let _e64 = tr[1u];
    let _e66 = dist;
    dist = (_e66 * ((1f * _e61) * _e64));
    let _e69 = uniforms.progress;
    if (_e69 < 0.5f) {
        let _e71 = (*p);
        param = _e71;
        let _e72 = getFromColor((&param));
        local = _e72;
    } else {
        let _e73 = (*p);
        param_1 = _e73;
        let _e74 = getToColor((&param_1));
        local = _e74;
    }
    let _e75 = local;
    let _e77 = uniforms.bgcolor;
    let _e78 = s;
    let _e79 = dist;
    return mix(_e75, _e77, vec4(step(_e78, _e79)));
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
