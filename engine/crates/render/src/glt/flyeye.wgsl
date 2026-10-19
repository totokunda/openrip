// flyeye — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/flyeye.glsl
// Author: gre
// License: MIT
// Description: The image breaks into a fly's-eye grid of lenses with color separation
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    size: f32,
    zoom: f32,
    colorSeparation: f32,
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

fn getFromColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv)[0u];
    let _e19 = (*uv)[1u];
    let _e22 = textureSampleLevel(_from, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv_1)[0u];
    let _e19 = (*uv_1)[1u];
    let _e22 = textureSampleLevel(_to, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var inv: f32;
    var disp: vec2<f32>;
    var texTo: vec4<f32>;
    var param: vec2<f32>;
    var texFrom: vec4<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    let _e25 = uniforms.progress;
    inv = (1f - _e25);
    let _e28 = uniforms.size;
    let _e30 = uniforms.zoom;
    let _e32 = (*p)[0u];
    let _e36 = uniforms.zoom;
    let _e38 = (*p)[1u];
    disp = (vec2<f32>(cos((_e30 * _e32)), sin((_e36 * _e38))) * _e28);
    let _e43 = (*p);
    let _e44 = inv;
    let _e45 = disp;
    param = (_e43 + (_e45 * _e44));
    let _e48 = getToColor((&param));
    texTo = _e48;
    let _e49 = (*p);
    let _e51 = uniforms.progress;
    let _e52 = disp;
    let _e55 = uniforms.colorSeparation;
    param_1 = (_e49 + ((_e52 * _e51) * (1f - _e55)));
    let _e59 = getFromColor((&param_1));
    let _e61 = (*p);
    let _e63 = uniforms.progress;
    let _e64 = disp;
    param_2 = (_e61 + (_e64 * _e63));
    let _e67 = getFromColor((&param_2));
    let _e69 = (*p);
    let _e71 = uniforms.progress;
    let _e72 = disp;
    let _e75 = uniforms.colorSeparation;
    param_3 = (_e69 + ((_e72 * _e71) * (1f + _e75)));
    let _e79 = getFromColor((&param_3));
    texFrom = vec4<f32>(_e59.x, _e67.y, _e79.z, 1f);
    let _e82 = texTo;
    let _e84 = uniforms.progress;
    let _e86 = texFrom;
    let _e87 = inv;
    return ((_e82 * _e84) + (_e86 * _e87));
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e16 = _uv_1;
    param_4 = _e16;
    let _e17 = transition((&param_4));
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
