// circle — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/circle.glsl
// Author: Fernando Kuteken
// License: MIT
// Description: The outgoing image closes into a circle over a background color, then the incoming one opens from it
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    center: vec2<f32>,
    backColor: vec3<f32>,
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
    let _e17 = (*uv)[0u];
    let _e19 = (*uv)[1u];
    let _e22 = textureSampleLevel(_to, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv_1)[0u];
    let _e19 = (*uv_1)[1u];
    let _e22 = textureSampleLevel(_from, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var distance_: f32;
    var radius: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;

    let _e20 = (*uv_2);
    let _e22 = uniforms.center;
    distance_ = length((_e20 - _e22));
    let _e26 = uniforms.progress;
    radius = (2.828427f * abs((_e26 - 0.5f)));
    let _e30 = distance_;
    let _e31 = radius;
    if (_e30 > _e31) {
        let _e34 = uniforms.backColor;
        return vec4<f32>(_e34.x, _e34.y, _e34.z, 1f);
    } else {
        let _e40 = uniforms.progress;
        if (_e40 < 0.5f) {
            let _e42 = (*uv_2);
            param = _e42;
            let _e43 = getFromColor((&param));
            return _e43;
        } else {
            let _e44 = (*uv_2);
            param_1 = _e44;
            let _e45 = getToColor((&param_1));
            return _e45;
        }
    }
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e16 = _uv_1;
    param_2 = _e16;
    let _e17 = transition((&param_2));
    _fragColor = _e17;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
