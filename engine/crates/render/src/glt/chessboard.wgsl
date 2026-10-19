// chessboard — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/chessboard.glsl
// Author: lql
// License: MIT
// Description: A chessboard pattern of squares reveals the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    grid_num: f32,
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

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var st: vec2<f32>;
    var idx: vec2<f32>;
    var grid: vec2<f32>;
    var a: vec4<f32>;
    var param: vec2<f32>;
    var b: vec4<f32>;
    var param_1: vec2<f32>;
    var checker: f32;
    var mixFactor: f32;
    var local: f32;
    var local_1: f32;

    let _e26 = (*uv_2);
    let _e28 = uniforms.grid_num;
    st = (_e26 * _e28);
    let _e30 = st;
    idx = floor(_e30);
    let _e32 = st;
    grid = fract(_e32);
    let _e34 = (*uv_2);
    param = _e34;
    let _e35 = getFromColor((&param));
    a = _e35;
    let _e36 = (*uv_2);
    param_1 = _e36;
    let _e37 = getToColor((&param_1));
    b = _e37;
    let _e39 = idx[0u];
    let _e41 = idx[1u];
    let _e42 = (_e39 + _e41);
    checker = (_e42 - (floor((_e42 / 2f)) * 2f));
    let _e48 = uniforms.progress;
    if (_e48 <= 0.5f) {
        let _e50 = checker;
        if (_e50 > 0.5f) {
            let _e53 = grid[0u];
            let _e55 = uniforms.progress;
            local = step(_e53, (_e55 * 2f));
        } else {
            local = 0f;
        }
        let _e58 = local;
        mixFactor = _e58;
    } else {
        let _e59 = checker;
        if (_e59 < 0.5f) {
            let _e62 = grid[0u];
            let _e64 = uniforms.progress;
            local_1 = step(_e62, ((_e64 - 0.5f) * 2f));
        } else {
            local_1 = 1f;
        }
        let _e68 = local_1;
        mixFactor = _e68;
    }
    let _e69 = a;
    let _e70 = b;
    let _e71 = mixFactor;
    return mix(_e69, _e70, vec4(_e71));
}

fn main_1() {
    var param_2: vec2<f32>;

    let _e15 = _uv_1;
    param_2 = _e15;
    let _e16 = transition((&param_2));
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
