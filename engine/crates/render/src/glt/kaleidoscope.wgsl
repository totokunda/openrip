// kaleidoscope — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/kaleidoscope.glsl
// Author: nwoeanhinnogaehr
// License: MIT
// Description: A crossfade through a spinning kaleidoscope
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    speed: f32,
    angle: f32,
    power: f32,
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
    let _e21 = (*uv)[0u];
    let _e23 = (*uv)[1u];
    let _e26 = textureSampleLevel(_to, _sampler, vec2<f32>(_e21, (1f - _e23)), 0f);
    return _e26;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e21 = (*uv_1)[0u];
    let _e23 = (*uv_1)[1u];
    let _e26 = textureSampleLevel(_from, _sampler, vec2<f32>(_e21, (1f - _e23)), 0f);
    return _e26;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p: vec2<f32>;
    var q: vec2<f32>;
    var t: f32;
    var i: i32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    let _e28 = (*uv_2);
    p = (_e28 / vec2<f32>(1f, 1f));
    let _e30 = p;
    q = _e30;
    let _e32 = uniforms.progress;
    let _e34 = uniforms.power;
    let _e37 = uniforms.speed;
    t = (pow(_e32, _e34) * _e37);
    let _e39 = p;
    p = (_e39 - vec2(0.5f));
    i = 0i;
    loop {
        let _e42 = i;
        if (_e42 < 7i) {
            let _e44 = t;
            let _e47 = p[0u];
            let _e49 = t;
            let _e52 = p[1u];
            let _e55 = t;
            let _e58 = p[1u];
            let _e60 = t;
            let _e63 = p[0u];
            p = vec2<f32>(((sin(_e44) * _e47) + (cos(_e49) * _e52)), ((sin(_e55) * _e58) - (cos(_e60) * _e63)));
            let _e68 = uniforms.angle;
            let _e69 = t;
            t = (_e69 + _e68);
            let _e71 = p;
            let _e72 = vec2(2f);
            p = abs(((_e71 - (floor((_e71 / _e72)) * _e72)) - vec2(1f)));
            continue;
        } else {
            break;
        }
        continuing {
            let _e80 = i;
            i = (_e80 + 1i);
        }
    }
    let _e82 = p;
    let _e83 = vec2(1f);
    let _e89 = q;
    param = _e89;
    let _e90 = getFromColor((&param));
    let _e91 = q;
    param_1 = _e91;
    let _e92 = getToColor((&param_1));
    let _e94 = uniforms.progress;
    let _e97 = p;
    param_2 = _e97;
    let _e98 = getFromColor((&param_2));
    let _e99 = p;
    param_3 = _e99;
    let _e100 = getToColor((&param_3));
    let _e102 = uniforms.progress;
    let _e106 = uniforms.progress;
    return mix(mix(_e90, _e92, vec4(_e94)), mix(_e98, _e100, vec4(_e102)), vec4((1f - (2f * abs((_e106 - 0.5f))))));
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e20 = _uv_1;
    param_4 = _e20;
    let _e21 = transition((&param_4));
    _fragColor = _e21;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
