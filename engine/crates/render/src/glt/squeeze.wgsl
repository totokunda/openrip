// squeeze — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/squeeze.glsl
// Author: gre
// License: MIT
// Description: The outgoing image is squeezed into a line with color separation, revealing the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
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

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var y: f32;
    var param: vec2<f32>;
    var fp: vec2<f32>;
    var off: vec2<f32>;
    var c: vec4<f32>;
    var param_1: vec2<f32>;
    var cn: vec4<f32>;
    var param_2: vec2<f32>;
    var cp: vec4<f32>;
    var param_3: vec2<f32>;

    let _e27 = (*uv_2)[1u];
    let _e30 = uniforms.progress;
    y = (0.5f + ((_e27 - 0.5f) / (1f - _e30)));
    let _e34 = y;
    let _e36 = y;
    if ((_e34 < 0f) || (_e36 > 1f)) {
        let _e39 = (*uv_2);
        param = _e39;
        let _e40 = getToColor((&param));
        return _e40;
    } else {
        let _e42 = (*uv_2)[0u];
        let _e43 = y;
        fp = vec2<f32>(_e42, _e43);
        let _e46 = uniforms.progress;
        let _e48 = uniforms.colorSeparation;
        off = (vec2<f32>(0f, _e48) * _e46);
        let _e51 = fp;
        param_1 = _e51;
        let _e52 = getFromColor((&param_1));
        c = _e52;
        let _e53 = fp;
        let _e54 = off;
        param_2 = (_e53 - _e54);
        let _e56 = getFromColor((&param_2));
        cn = _e56;
        let _e57 = fp;
        let _e58 = off;
        param_3 = (_e57 + _e58);
        let _e60 = getFromColor((&param_3));
        cp = _e60;
        let _e62 = cn[0u];
        let _e64 = c[1u];
        let _e66 = cp[2u];
        let _e68 = c[3u];
        return vec4<f32>(_e62, _e64, _e66, _e68);
    }
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
