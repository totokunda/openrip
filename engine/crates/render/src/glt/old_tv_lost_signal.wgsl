// old_tv_lost_signal — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/old_tv_lost_signal.glsl
// Author: mernking (gitlab.com/Godswork)
// License: MIT
// Description: A crossfade with drifting tracking lines and tearing, like a TV losing its signal
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
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

fn hash(p: ptr<function, vec2<f32>>) -> f32 {
    let _e26 = (*p);
    return fract((sin(dot(_e26, vec2<f32>(127.1f, 311.7f))) * 43758.547f));
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e27 = (*uv)[0u];
    let _e29 = (*uv)[1u];
    let _e32 = textureSampleLevel(_to, _sampler, vec2<f32>(_e27, (1f - _e29)), 0f);
    return _e32;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e27 = (*uv_1)[0u];
    let _e29 = (*uv_1)[1u];
    let _e32 = textureSampleLevel(_from, _sampler, vec2<f32>(_e27, (1f - _e29)), 0f);
    return _e32;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p_1: f32;
    var strength: f32;
    var tv: vec2<f32>;
    var fromColor: vec4<f32>;
    var param: vec2<f32>;
    var toColor: vec4<f32>;
    var param_1: vec2<f32>;
    var color: vec4<f32>;
    var lineY: f32;
    var noise: f32;
    var param_2: vec2<f32>;
    var line: f32;
    var drift: f32;
    var shiftedFrom: vec4<f32>;
    var param_3: vec2<f32>;
    var shiftedTo: vec4<f32>;
    var param_4: vec2<f32>;
    var lineColor: vec4<f32>;
    var scan: f32;

    let _e46 = uniforms.progress;
    p_1 = _e46;
    let _e47 = p_1;
    strength = sin((_e47 * 3.1415927f));
    let _e50 = (*uv_2);
    tv = _e50;
    let _e51 = tv;
    param = _e51;
    let _e52 = getFromColor((&param));
    fromColor = _e52;
    let _e53 = tv;
    param_1 = _e53;
    let _e54 = getToColor((&param_1));
    toColor = _e54;
    let _e55 = fromColor;
    let _e56 = toColor;
    let _e57 = p_1;
    color = mix(_e55, _e56, vec4(_e57));
    let _e61 = tv[1u];
    lineY = floor((_e61 * 120f));
    let _e64 = lineY;
    let _e65 = p_1;
    param_2 = vec2<f32>(_e64, (_e65 * 20f));
    let _e68 = hash((&param_2));
    noise = _e68;
    let _e69 = noise;
    line = step(0.92f, _e69);
    let _e72 = tv[1u];
    let _e74 = p_1;
    let _e79 = strength;
    drift = ((sin(((_e72 * 30f) + (_e74 * 10f))) * 0.02f) * _e79);
    let _e81 = tv;
    let _e82 = drift;
    param_3 = (_e81 + vec2<f32>(_e82, 0f));
    let _e85 = getFromColor((&param_3));
    shiftedFrom = _e85;
    let _e86 = tv;
    let _e87 = drift;
    param_4 = (_e86 + vec2<f32>(_e87, 0f));
    let _e90 = getToColor((&param_4));
    shiftedTo = _e90;
    let _e91 = shiftedFrom;
    let _e92 = shiftedTo;
    let _e93 = p_1;
    lineColor = mix(_e91, _e92, vec4(_e93));
    let _e96 = color;
    let _e97 = lineColor;
    let _e98 = line;
    let _e99 = strength;
    color = mix(_e96, _e97, vec4((_e98 * _e99)));
    let _e104 = tv[1u];
    scan = (sin((_e104 * 900f)) * 0.03f);
    let _e108 = scan;
    let _e109 = strength;
    let _e111 = color;
    let _e114 = (_e111.xyz - vec3((_e108 * _e109)));
    color[0u] = _e114.x;
    color[1u] = _e114.y;
    color[2u] = _e114.z;
    let _e121 = color;
    return _e121;
}

fn main_1() {
    var param_5: vec2<f32>;

    let _e26 = _uv_1;
    param_5 = _e26;
    let _e27 = transition((&param_5));
    _fragColor = _e27;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
