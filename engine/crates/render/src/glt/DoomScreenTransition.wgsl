// DoomScreenTransition — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/DoomScreenTransition.glsl
// Author: Zeh Fernando
// License: MIT
// Description: The outgoing image melts down in uneven columns, like the Doom screen wipe
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    bars: i32,
    amplitude: f32,
    noise: f32,
    frequency: f32,
    dripScale: f32,
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
    let _e30 = (*uv)[0u];
    let _e32 = (*uv)[1u];
    let _e35 = textureSampleLevel(_to, _sampler, vec2<f32>(_e30, (1f - _e32)), 0f);
    return _e35;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e30 = (*uv_1)[0u];
    let _e32 = (*uv_1)[1u];
    let _e35 = textureSampleLevel(_from, _sampler, vec2<f32>(_e30, (1f - _e32)), 0f);
    return _e35;
}

fn drip(num: ptr<function, i32>) -> f32 {
    let _e29 = (*num);
    let _e32 = uniforms.bars;
    let _e39 = uniforms.dripScale;
    return (sin(((f32(_e29) / f32((_e32 - 1i))) * 3.141592f)) * _e39);
}

fn rand(num_1: ptr<function, i32>) -> f32 {
    let _e29 = (*num_1);
    let _e31 = (f32(_e29) * 67123.31f);
    let _e36 = (*num_1);
    let _e41 = (*num_1);
    return fract((((_e31 - (floor((_e31 / 12f)) * 12f)) * sin((f32(_e36) * 10.3f))) * cos(f32(_e41))));
}

fn wave(num_2: ptr<function, i32>) -> f32 {
    var fn_: f32;

    let _e30 = (*num_2);
    let _e33 = uniforms.frequency;
    let _e37 = uniforms.bars;
    fn_ = (((f32(_e30) * _e33) * 0.1f) * f32(_e37));
    let _e40 = fn_;
    let _e43 = fn_;
    let _e47 = fn_;
    return ((((cos((_e40 * 0.5f)) * cos((_e43 * 0.13f))) * sin(((_e47 + 10f) * 0.3f))) / 2f) + 0.5f);
}

fn pos(num_3: ptr<function, i32>) -> f32 {
    var local: f32;
    var param: i32;
    var param_1: i32;
    var param_2: i32;
    var local_1: f32;
    var param_3: i32;

    let _e36 = uniforms.noise;
    if (_e36 == 0f) {
        let _e38 = (*num_3);
        param = _e38;
        let _e39 = wave((&param));
        local = _e39;
    } else {
        let _e40 = (*num_3);
        param_1 = _e40;
        let _e41 = wave((&param_1));
        let _e42 = (*num_3);
        param_2 = _e42;
        let _e43 = rand((&param_2));
        let _e45 = uniforms.noise;
        local = mix(_e41, _e43, _e45);
    }
    let _e47 = local;
    let _e49 = uniforms.dripScale;
    if (_e49 == 0f) {
        local_1 = 0f;
    } else {
        let _e51 = (*num_3);
        param_3 = _e51;
        let _e52 = drip((&param_3));
        local_1 = _e52;
    }
    let _e53 = local_1;
    return (_e47 + _e53);
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var bar: i32;
    var scale: f32;
    var param_4: i32;
    var phase: f32;
    var posY: f32;
    var p: vec2<f32>;
    var c: vec4<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;

    let _e39 = (*uv_2)[0u];
    let _e41 = uniforms.bars;
    bar = i32((_e39 * f32(_e41)));
    let _e45 = bar;
    param_4 = _e45;
    let _e46 = pos((&param_4));
    let _e48 = uniforms.amplitude;
    scale = (1f + (_e46 * _e48));
    let _e52 = uniforms.progress;
    let _e53 = scale;
    phase = (_e52 * _e53);
    let _e56 = (*uv_2)[1u];
    posY = (_e56 / 1f);
    let _e58 = phase;
    let _e59 = posY;
    if ((_e58 + _e59) < 1f) {
        let _e63 = (*uv_2)[0u];
        let _e65 = (*uv_2)[1u];
        let _e66 = phase;
        p = (vec2<f32>(_e63, (_e65 + mix(0f, 1f, _e66))) / vec2<f32>(1f, 1f));
        let _e71 = p;
        param_5 = _e71;
        let _e72 = getFromColor((&param_5));
        c = _e72;
    } else {
        let _e73 = (*uv_2);
        p = (_e73 / vec2<f32>(1f, 1f));
        let _e75 = p;
        param_6 = _e75;
        let _e76 = getToColor((&param_6));
        c = _e76;
    }
    let _e77 = c;
    return _e77;
}

fn main_1() {
    var param_7: vec2<f32>;

    let _e29 = _uv_1;
    param_7 = _e29;
    let _e30 = transition((&param_7));
    _fragColor = _e30;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
