// SimpleZoomOut — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/SimpleZoomOut.glsl
// Author: Tianshuo
// License: MIT
// Description: The incoming image zooms out into place while fading in
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    zoom_quickness: f32,
    fade: i32,
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

fn zoom(uv_1: ptr<function, vec2<f32>>, amount: ptr<function, f32>) -> vec2<f32> {
    let _e17 = (*uv_1);
    let _e20 = (*amount);
    return (vec2(0.5f) + ((_e17 - vec2(0.5f)) * (1f - _e20)));
}

fn getFromColor(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e17 = (*uv_2)[0u];
    let _e19 = (*uv_2)[1u];
    let _e22 = textureSampleLevel(_from, _sampler, vec2<f32>(_e17, (1f - _e19)), 0f);
    return _e22;
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var nQuick: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: f32;
    var param_3: vec2<f32>;
    var local: f32;

    let _e23 = uniforms.zoom_quickness;
    nQuick = clamp(_e23, 0.2f, 1f);
    let _e25 = (*uv_3);
    param = _e25;
    let _e26 = getFromColor((&param));
    let _e27 = nQuick;
    let _e30 = uniforms.progress;
    let _e33 = (*uv_3);
    param_1 = _e33;
    param_2 = (1f - smoothstep((1f - _e27), 1f, _e30));
    let _e34 = zoom((&param_1), (&param_2));
    param_3 = _e34;
    let _e35 = getToColor((&param_3));
    let _e37 = uniforms.fade;
    if (_e37 != 0i) {
        let _e39 = nQuick;
        let _e42 = uniforms.progress;
        local = smoothstep((1f - _e39), 1f, _e42);
    } else {
        let _e45 = uniforms.progress;
        let _e46 = nQuick;
        local = select(1f, 0f, (_e45 < (1f - _e46)));
    }
    let _e50 = local;
    return mix(_e26, _e35, vec4(_e50));
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
