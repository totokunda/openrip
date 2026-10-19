// wind — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/wind.glsl
// Author: gre
// License: MIT
// Description: A ragged left-to-right wipe, as if the image was blown away by the wind
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    size: f32,
    reversed: i32,
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
    let _e19 = (*uv)[0u];
    let _e21 = (*uv)[1u];
    let _e24 = textureSampleLevel(_to, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e19 = (*uv_1)[0u];
    let _e21 = (*uv_1)[1u];
    let _e24 = textureSampleLevel(_from, _sampler, vec2<f32>(_e19, (1f - _e21)), 0f);
    return _e24;
}

fn rand(co: ptr<function, vec2<f32>>) -> f32 {
    let _e18 = (*co);
    return fract((sin(dot(_e18, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var x: f32;
    var local: f32;
    var r: f32;
    var param: vec2<f32>;
    var m: f32;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e26 = uniforms.reversed;
    if (_e26 != 0i) {
        let _e29 = (*uv_2)[0u];
        local = (1f - _e29);
    } else {
        let _e32 = (*uv_2)[0u];
        local = _e32;
    }
    let _e33 = local;
    x = _e33;
    let _e35 = (*uv_2)[1u];
    param = vec2<f32>(0f, _e35);
    let _e37 = rand((&param));
    r = _e37;
    let _e39 = uniforms.size;
    let _e41 = x;
    let _e43 = uniforms.size;
    let _e47 = uniforms.size;
    let _e48 = r;
    let _e52 = uniforms.progress;
    let _e54 = uniforms.size;
    m = smoothstep(0f, -(_e39), (((_e41 * (1f - _e43)) + (_e47 * _e48)) - (_e52 * (1f + _e54))));
    let _e59 = (*uv_2);
    param_1 = _e59;
    let _e60 = getFromColor((&param_1));
    let _e61 = (*uv_2);
    param_2 = _e61;
    let _e62 = getToColor((&param_2));
    let _e63 = m;
    return mix(_e60, _e62, vec4(_e63));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e18 = _uv_1;
    param_3 = _e18;
    let _e19 = transition((&param_3));
    _fragColor = _e19;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
