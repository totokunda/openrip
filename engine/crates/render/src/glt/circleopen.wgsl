// circleopen — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/circleopen.glsl
// Author: gre
// License: MIT
// Description: A soft-edged circle opens from the center to reveal the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    smoothness: f32,
    opening: i32,
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
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var x: f32;
    var local: f32;
    var m: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var local_1: f32;

    let _e24 = uniforms.opening;
    if (_e24 != 0i) {
        let _e27 = uniforms.progress;
        local = _e27;
    } else {
        let _e29 = uniforms.progress;
        local = (1f - _e29);
    }
    let _e31 = local;
    x = _e31;
    let _e33 = uniforms.smoothness;
    let _e35 = (*uv_2);
    let _e38 = x;
    let _e40 = uniforms.smoothness;
    m = smoothstep(-(_e33), 0f, ((1.4142135f * distance(vec2<f32>(0.5f, 0.5f), _e35)) - (_e38 * (1f + _e40))));
    let _e45 = (*uv_2);
    param = _e45;
    let _e46 = getFromColor((&param));
    let _e47 = (*uv_2);
    param_1 = _e47;
    let _e48 = getToColor((&param_1));
    let _e50 = uniforms.opening;
    if (_e50 != 0i) {
        let _e52 = m;
        local_1 = (1f - _e52);
    } else {
        let _e54 = m;
        local_1 = _e54;
    }
    let _e55 = local_1;
    return mix(_e46, _e48, vec4(_e55));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e17 = _uv_1;
    param_2 = _e17;
    let _e18 = transition((&param_2));
    _fragColor = _e18;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
