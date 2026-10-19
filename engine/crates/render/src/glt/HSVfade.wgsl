// HSVfade — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/HSVfade.glsl
// Author: nwoeanhinnogaehr
// License: MIT
// Description: A crossfade through the HSV color space that cycles through hues
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

fn hsv2rgb(c: ptr<function, vec3<f32>>) -> vec3<f32> {
    var p: vec3<f32>;

    let _e27 = (*c);
    p = abs(((fract((_e27.xxx + vec3<f32>(1f, 0.6666667f, 0.33333334f))) * 6f) - vec3<f32>(3f, 3f, 3f)));
    let _e35 = (*c)[2u];
    let _e36 = p;
    let _e42 = (*c)[1u];
    return (mix(vec3<f32>(1f, 1f, 1f), clamp((_e36 - vec3<f32>(1f, 1f, 1f)), vec3(0f), vec3(1f)), vec3(_e42)) * _e35);
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e27 = (*uv)[0u];
    let _e29 = (*uv)[1u];
    let _e32 = textureSampleLevel(_to, _sampler, vec2<f32>(_e27, (1f - _e29)), 0f);
    return _e32;
}

fn rgb2hsv(c_1: ptr<function, vec3<f32>>) -> vec3<f32> {
    var p_1: vec4<f32>;
    var q: vec4<f32>;
    var d: f32;

    let _e29 = (*c_1);
    let _e30 = _e29.zy;
    let _e36 = (*c_1);
    let _e37 = _e36.yz;
    let _e44 = (*c_1)[2u];
    let _e46 = (*c_1)[1u];
    p_1 = mix(vec4<f32>(_e30.x, _e30.y, vec2<f32>(-1f, 0.6666667f).x, vec2<f32>(-1f, 0.6666667f).y), vec4<f32>(_e37.x, _e37.y, vec2<f32>(0f, -0.33333334f).x, vec2<f32>(0f, -0.33333334f).y), vec4(step(_e44, _e46)));
    let _e50 = p_1;
    let _e51 = _e50.xyw;
    let _e53 = (*c_1)[0u];
    let _e59 = (*c_1)[0u];
    let _e60 = p_1;
    let _e61 = _e60.yzx;
    let _e67 = p_1[0u];
    let _e69 = (*c_1)[0u];
    q = mix(vec4<f32>(_e51.x, _e51.y, _e51.z, _e53), vec4<f32>(_e59, _e61.x, _e61.y, _e61.z), vec4(step(_e67, _e69)));
    let _e74 = q[0u];
    let _e76 = q[3u];
    let _e78 = q[1u];
    d = (_e74 - min(_e76, _e78));
    let _e82 = q[2u];
    let _e84 = q[3u];
    let _e86 = q[1u];
    let _e88 = d;
    let _e94 = d;
    let _e96 = q[0u];
    let _e100 = q[0u];
    return vec3<f32>(abs((_e82 + ((_e84 - _e86) / ((6f * _e88) + 0.001f)))), (_e94 / (_e96 + 0.001f)), _e100);
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e27 = (*uv_1)[0u];
    let _e29 = (*uv_1)[1u];
    let _e32 = textureSampleLevel(_from, _sampler, vec2<f32>(_e27, (1f - _e29)), 0f);
    return _e32;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var a: vec3<f32>;
    var param: vec2<f32>;
    var param_1: vec3<f32>;
    var b: vec3<f32>;
    var param_2: vec2<f32>;
    var param_3: vec3<f32>;
    var m: vec3<f32>;
    var param_4: vec3<f32>;

    let _e34 = (*uv_2);
    param = _e34;
    let _e35 = getFromColor((&param));
    param_1 = _e35.xyz;
    let _e37 = rgb2hsv((&param_1));
    a = _e37;
    let _e38 = (*uv_2);
    param_2 = _e38;
    let _e39 = getToColor((&param_2));
    param_3 = _e39.xyz;
    let _e41 = rgb2hsv((&param_3));
    b = _e41;
    let _e42 = a;
    let _e43 = b;
    let _e45 = uniforms.progress;
    m = mix(_e42, _e43, vec3(_e45));
    let _e48 = m;
    param_4 = _e48;
    let _e49 = hsv2rgb((&param_4));
    return vec4<f32>(_e49.x, _e49.y, _e49.z, 1f);
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
