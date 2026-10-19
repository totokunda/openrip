// mosaic_transition — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/mosaic_transition.glsl
// Author: YueDev
// License: MIT
// Description: Both images break into mosaic blocks that blend, then sharpen into the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    mosaicNum: f32,
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
    let _e16 = (*uv)[0u];
    let _e18 = (*uv)[1u];
    let _e21 = textureSampleLevel(_to, _sampler, vec2<f32>(_e16, (1f - _e18)), 0f);
    return _e21;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e16 = (*uv_1)[0u];
    let _e18 = (*uv_1)[1u];
    let _e21 = textureSampleLevel(_from, _sampler, vec2<f32>(_e16, (1f - _e18)), 0f);
    return _e21;
}

fn getMosaicUV(uv_2: ptr<function, vec2<f32>>) -> vec2<f32> {
    var mosaicWidth: f32;
    var mX: f32;
    var mY: f32;

    let _e19 = uniforms.mosaicNum;
    let _e22 = uniforms.progress;
    let _e24 = uniforms.progress;
    mosaicWidth = ((2f / _e19) * min(_e22, (1f - _e24)));
    let _e29 = (*uv_2)[0u];
    let _e30 = mosaicWidth;
    mX = (floor((_e29 / _e30)) + 0.5f);
    let _e35 = (*uv_2)[1u];
    let _e36 = mosaicWidth;
    mY = (floor((_e35 / _e36)) + 0.5f);
    let _e40 = mX;
    let _e41 = mosaicWidth;
    let _e43 = mY;
    let _e44 = mosaicWidth;
    return vec2<f32>((_e40 * _e41), (_e43 * _e44));
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var mosaicUV: vec2<f32>;
    var local: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    let _e21 = uniforms.progress;
    let _e23 = uniforms.progress;
    if (min(_e21, (1f - _e23)) == 0f) {
        let _e27 = (*uv_3);
        local = _e27;
    } else {
        let _e28 = (*uv_3);
        param = _e28;
        let _e29 = getMosaicUV((&param));
        local = _e29;
    }
    let _e30 = local;
    mosaicUV = _e30;
    let _e31 = mosaicUV;
    param_1 = _e31;
    let _e32 = getFromColor((&param_1));
    let _e33 = mosaicUV;
    param_2 = _e33;
    let _e34 = getToColor((&param_2));
    let _e36 = uniforms.progress;
    let _e38 = uniforms.progress;
    return mix(_e32, _e34, vec4((_e36 * _e38)));
}

fn main_1() {
    var param_3: vec2<f32>;

    let _e15 = _uv_1;
    param_3 = _e15;
    let _e16 = transition((&param_3));
    _fragColor = _e16;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
