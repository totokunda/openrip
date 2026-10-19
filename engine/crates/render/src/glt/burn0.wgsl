// burn0 — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/burn0.glsl
// Author: liubailin2020@gmail.com
// License: MIT
// Description: The outgoing image burns away in noisy, glowing patches
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    burnColor: vec3<f32>,
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

fn random(st: ptr<function, vec2<f32>>) -> f32 {
    let _e28 = (*st);
    return fract((sin(dot(_e28, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn noise(st_1: ptr<function, vec2<f32>>) -> f32 {
    var i: vec2<f32>;
    var f: vec2<f32>;
    var a: f32;
    var param: vec2<f32>;
    var b: f32;
    var param_1: vec2<f32>;
    var c: f32;
    var param_2: vec2<f32>;
    var d: f32;
    var param_3: vec2<f32>;
    var u: vec2<f32>;

    let _e39 = (*st_1);
    i = floor(_e39);
    let _e41 = (*st_1);
    f = fract(_e41);
    let _e43 = i;
    param = _e43;
    let _e44 = random((&param));
    a = _e44;
    let _e45 = i;
    param_1 = (_e45 + vec2<f32>(1f, 0f));
    let _e47 = random((&param_1));
    b = _e47;
    let _e48 = i;
    param_2 = (_e48 + vec2<f32>(0f, 1f));
    let _e50 = random((&param_2));
    c = _e50;
    let _e51 = i;
    param_3 = (_e51 + vec2<f32>(1f, 1f));
    let _e53 = random((&param_3));
    d = _e53;
    let _e54 = f;
    let _e55 = f;
    let _e57 = f;
    u = ((_e54 * _e55) * (vec2(3f) - (_e57 * 2f)));
    let _e62 = a;
    let _e63 = b;
    let _e65 = u[0u];
    let _e67 = c;
    let _e68 = a;
    let _e71 = u[1u];
    let _e74 = u[0u];
    let _e78 = d;
    let _e79 = b;
    let _e82 = u[0u];
    let _e85 = u[1u];
    return ((mix(_e62, _e63, _e65) + (((_e67 - _e68) * _e71) * (1f - _e74))) + (((_e78 - _e79) * _e82) * _e85));
}

fn fbm(st_2: ptr<function, vec2<f32>>) -> f32 {
    var value: f32;
    var amplitude: f32;
    var i_1: i32;
    var param_4: vec2<f32>;

    value = 0f;
    amplitude = 0.5f;
    i_1 = 0i;
    loop {
        let _e32 = i_1;
        if (_e32 < 4i) {
            let _e34 = amplitude;
            let _e35 = (*st_2);
            param_4 = _e35;
            let _e36 = noise((&param_4));
            let _e38 = value;
            value = (_e38 + (_e34 * _e36));
            let _e40 = (*st_2);
            (*st_2) = (_e40 * 2f);
            let _e42 = amplitude;
            amplitude = (_e42 * 0.5f);
            continue;
        } else {
            break;
        }
        continuing {
            let _e44 = i_1;
            i_1 = (_e44 + 1i);
        }
    }
    let _e46 = value;
    return _e46;
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e29 = (*uv)[0u];
    let _e31 = (*uv)[1u];
    let _e34 = textureSampleLevel(_to, _sampler, vec2<f32>(_e29, (1f - _e31)), 0f);
    return _e34;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e29 = (*uv_1)[0u];
    let _e31 = (*uv_1)[1u];
    let _e34 = textureSampleLevel(_from, _sampler, vec2<f32>(_e29, (1f - _e31)), 0f);
    return _e34;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var from_: vec4<f32>;
    var param_7: vec2<f32>;
    var to: vec4<f32>;
    var param_8: vec2<f32>;
    var n: f32;
    var param_9: vec2<f32>;
    var l: f32;
    var edge: f32;

    let _e39 = uniforms.progress;
    if (_e39 <= 0f) {
        let _e41 = (*uv_2);
        param_5 = _e41;
        let _e42 = getFromColor((&param_5));
        return _e42;
    }
    let _e44 = uniforms.progress;
    if (_e44 >= 1f) {
        let _e46 = (*uv_2);
        param_6 = _e46;
        let _e47 = getToColor((&param_6));
        return _e47;
    }
    let _e48 = (*uv_2);
    param_7 = _e48;
    let _e49 = getFromColor((&param_7));
    from_ = _e49;
    let _e50 = (*uv_2);
    param_8 = _e50;
    let _e51 = getToColor((&param_8));
    to = _e51;
    let _e52 = (*uv_2);
    param_9 = (_e52 * 4f);
    let _e54 = fbm((&param_9));
    n = _e54;
    let _e56 = uniforms.progress;
    let _e58 = uniforms.progress;
    let _e60 = n;
    l = smoothstep(_e56, (_e58 + 0.05f), _e60);
    let _e62 = l;
    let _e64 = l;
    edge = (((1f - _e62) * _e64) * 5f);
    let _e67 = to;
    let _e68 = from_;
    let _e69 = l;
    let _e73 = uniforms.burnColor;
    let _e78 = edge;
    return (mix(_e67, _e68, vec4(_e69)) + (vec4<f32>(_e73.x, _e73.y, _e73.z, 0f) * _e78));
}

fn main_1() {
    var param_10: vec2<f32>;

    let _e28 = _uv_1;
    param_10 = _e28;
    let _e29 = transition((&param_10));
    _fragColor = _e29;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
