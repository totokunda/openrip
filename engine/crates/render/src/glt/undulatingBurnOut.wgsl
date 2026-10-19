// undulatingBurnOut — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/undulatingBurnOut.glsl
// Author: pthrasher
// License: MIT
// Description: A circle with a wavy edge burns out from the center to reveal the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    smoothness: f32,
    center: vec2<f32>,
    color: vec3<f32>,
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
    let _e37 = (*uv)[0u];
    let _e39 = (*uv)[1u];
    let _e42 = textureSampleLevel(_to, _sampler, vec2<f32>(_e37, (1f - _e39)), 0f);
    return _e42;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e37 = (*uv_1)[0u];
    let _e39 = (*uv_1)[1u];
    let _e42 = textureSampleLevel(_from, _sampler, vec2<f32>(_e37, (1f - _e39)), 0f);
    return _e42;
}

fn getGradient(r: ptr<function, f32>, dist: ptr<function, f32>) -> f32 {
    var d: f32;

    let _e38 = (*r);
    let _e39 = (*dist);
    d = (_e38 - _e39);
    let _e42 = uniforms.smoothness;
    let _e44 = (*r);
    let _e45 = (*dist);
    let _e47 = uniforms.smoothness;
    let _e52 = d;
    let _e55 = d;
    let _e57 = d;
    return mix(smoothstep(-(_e42), 0f, (_e44 - (_e45 * (1f + _e47)))), (-1f - step(0.005f, _e52)), (step(-0.005f, _e55) * step(_e57, 0.01f)));
}

fn quadraticInOut(t: ptr<function, f32>) -> f32 {
    var p: f32;
    var local: f32;

    let _e38 = (*t);
    let _e40 = (*t);
    p = ((2f * _e38) * _e40);
    let _e42 = (*t);
    if (_e42 < 0.5f) {
        let _e44 = p;
        local = _e44;
    } else {
        let _e45 = p;
        let _e47 = (*t);
        local = ((-(_e45) + (4f * _e47)) - 1f);
    }
    let _e51 = local;
    return _e51;
}

fn getWave(p_1: ptr<function, vec2<f32>>) -> f32 {
    var _p: vec2<f32>;
    var rads: f32;
    var degs: f32;
    var range: vec2<f32>;
    var domain: vec2<f32>;
    var ratio: f32;
    var x: f32;
    var magnitude: f32;
    var offset: f32;
    var ease_degs: f32;
    var param: f32;
    var deg_wave_pos: f32;

    let _e48 = (*p_1);
    let _e50 = uniforms.center;
    _p = (_e48 - _e50);
    let _e53 = _p[1u];
    let _e55 = _p[0u];
    rads = atan2(_e53, _e55);
    let _e57 = rads;
    degs = (degrees(_e57) + 180f);
    range = vec2<f32>(0f, 94.24778f);
    domain = vec2<f32>(0f, 360f);
    ratio = 0.2617994f;
    let _e60 = degs;
    let _e61 = ratio;
    degs = (_e60 * _e61);
    let _e64 = uniforms.progress;
    x = _e64;
    let _e65 = x;
    magnitude = mix(0.02f, 0.09f, smoothstep(0f, 1f, _e65));
    let _e68 = x;
    offset = mix(40f, 30f, smoothstep(0f, 1f, _e68));
    let _e71 = degs;
    param = sin(_e71);
    let _e73 = quadraticInOut((&param));
    ease_degs = _e73;
    let _e74 = ease_degs;
    let _e75 = magnitude;
    let _e77 = x;
    let _e78 = offset;
    deg_wave_pos = ((_e74 * _e75) * sin((_e77 * _e78)));
    let _e82 = x;
    let _e84 = uniforms.smoothness;
    let _e86 = x;
    let _e91 = deg_wave_pos;
    return ((_e82 - (max(_e84, 0.01f) * (1f - smoothstep(0f, 0.1f, _e86)))) + _e91);
}

fn transition(p_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var dist_1: f32;
    var m: f32;
    var param_1: vec2<f32>;
    var param_2: f32;
    var param_3: f32;
    var cfrom: vec4<f32>;
    var param_4: vec2<f32>;
    var cto: vec4<f32>;
    var param_5: vec2<f32>;

    let _e46 = uniforms.center;
    let _e47 = (*p_2);
    dist_1 = distance(_e46, _e47);
    let _e49 = (*p_2);
    param_1 = _e49;
    let _e50 = getWave((&param_1));
    param_2 = _e50;
    let _e51 = dist_1;
    param_3 = _e51;
    let _e52 = getGradient((&param_2), (&param_3));
    m = _e52;
    let _e53 = (*p_2);
    param_4 = _e53;
    let _e54 = getFromColor((&param_4));
    cfrom = _e54;
    let _e55 = (*p_2);
    param_5 = _e55;
    let _e56 = getToColor((&param_5));
    cto = _e56;
    let _e57 = cfrom;
    let _e58 = cto;
    let _e59 = m;
    let _e62 = cfrom;
    let _e64 = uniforms.color;
    let _e71 = m;
    return mix(mix(_e57, _e58, vec4(_e59)), mix(_e62, vec4<f32>(_e64.x, _e64.y, _e64.z, 1f), vec4(0.75f)), vec4(step(_e71, -2f)));
}

fn main_1() {
    var param_6: vec2<f32>;

    let _e36 = _uv_1;
    param_6 = _e36;
    let _e37 = transition((&param_6));
    _fragColor = _e37;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
