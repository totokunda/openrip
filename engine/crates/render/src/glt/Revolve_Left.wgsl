// Revolve_Left — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Revolve_Left.glsl
// Author: bread
// License: MIT
// Description: The outgoing image swirls and zooms with motion blur into the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    center: vec2<f32>,
    direction: f32,
    maxRotation: f32,
    peakZoom: f32,
    swirl: f32,
    barrel: f32,
    motionBlur: f32,
    switchStart: f32,
    switchEnd: f32,
    shadow: f32,
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
    let _e48 = (*uv)[0u];
    let _e50 = (*uv)[1u];
    let _e53 = textureSampleLevel(_to, _sampler, vec2<f32>(_e48, (1f - _e50)), 0f);
    return _e53;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e48 = (*uv_1)[0u];
    let _e50 = (*uv_1)[1u];
    let _e53 = textureSampleLevel(_from, _sampler, vec2<f32>(_e48, (1f - _e50)), 0f);
    return _e53;
}

fn rotate2(p: ptr<function, vec2<f32>>, a: ptr<function, f32>) -> vec2<f32> {
    var s: f32;
    var c: f32;

    let _e50 = (*a);
    s = sin(_e50);
    let _e52 = (*a);
    c = cos(_e52);
    let _e54 = c;
    let _e56 = (*p)[0u];
    let _e58 = s;
    let _e60 = (*p)[1u];
    let _e63 = s;
    let _e65 = (*p)[0u];
    let _e67 = c;
    let _e69 = (*p)[1u];
    return vec2<f32>(((_e54 * _e56) - (_e58 * _e60)), ((_e63 * _e65) + (_e67 * _e69)));
}

fn sat(x: ptr<function, f32>) -> f32 {
    let _e47 = (*x);
    return clamp(_e47, 0f, 1f);
}

fn ease(x_1: ptr<function, f32>) -> f32 {
    var param: f32;

    let _e48 = (*x_1);
    param = _e48;
    let _e49 = sat((&param));
    (*x_1) = _e49;
    let _e50 = (*x_1);
    let _e51 = (*x_1);
    let _e53 = (*x_1);
    return ((_e50 * _e51) * (3f - (2f * _e53)));
}

fn revolveEnvelope(t: ptr<function, f32>) -> f32 {
    var rise: f32;
    var param_1: f32;
    var fall: f32;
    var param_2: f32;

    let _e51 = (*t);
    param_1 = ((_e51 - 0.1f) / 0.33f);
    let _e54 = ease((&param_1));
    rise = _e54;
    let _e55 = (*t);
    param_2 = ((_e55 - 0.43f) / 0.29f);
    let _e58 = ease((&param_2));
    fall = (1f - _e58);
    let _e60 = rise;
    let _e61 = fall;
    return (_e60 * _e61);
}

fn warpUv(uv_2: ptr<function, vec2<f32>>, t_1: ptr<function, f32>) -> vec2<f32> {
    var e: f32;
    var param_3: f32;
    var p_1: vec2<f32>;
    var r: f32;
    var edgeSpin: f32;
    var coreSpin: f32;
    var param_4: f32;
    var visibleAngle: f32;
    var param_5: vec2<f32>;
    var param_6: f32;
    var sc: f32;
    var rr: f32;

    let _e60 = (*t_1);
    param_3 = _e60;
    let _e61 = revolveEnvelope((&param_3));
    e = _e61;
    let _e62 = (*uv_2);
    let _e64 = uniforms.center;
    p_1 = (_e62 - _e64);
    let _e67 = uniforms.ratio;
    let _e69 = p_1[0u];
    p_1[0u] = (_e69 * _e67);
    let _e72 = p_1;
    r = length(_e72);
    let _e75 = uniforms.maxRotation;
    let _e76 = e;
    edgeSpin = (_e75 * _e76);
    let _e79 = uniforms.swirl;
    let _e80 = e;
    let _e82 = r;
    param_4 = (_e82 / 0.96f);
    let _e84 = sat((&param_4));
    coreSpin = ((_e79 * _e80) * pow((1f - _e84), 1.55f));
    let _e89 = uniforms.direction;
    let _e90 = edgeSpin;
    let _e91 = coreSpin;
    visibleAngle = (_e89 * (_e90 + _e91));
    let _e94 = visibleAngle;
    let _e96 = p_1;
    param_5 = _e96;
    param_6 = -(_e94);
    let _e97 = rotate2((&param_5), (&param_6));
    p_1 = _e97;
    let _e99 = uniforms.peakZoom;
    let _e101 = e;
    sc = (1f + ((_e99 - 1f) * pow(_e101, 0.85f)));
    let _e105 = sc;
    let _e106 = p_1;
    p_1 = (_e106 / vec2(_e105));
    let _e109 = p_1;
    rr = length(_e109);
    let _e112 = uniforms.barrel;
    let _e113 = e;
    let _e115 = rr;
    let _e117 = rr;
    let _e121 = p_1;
    p_1 = (_e121 * (1f + ((((_e112 * _e113) * _e115) * _e117) * 2.8f)));
    let _e124 = uniforms.ratio;
    let _e126 = p_1[0u];
    p_1[0u] = (_e126 / _e124);
    let _e129 = p_1;
    let _e131 = uniforms.center;
    return clamp((_e129 + _e131), vec2<f32>(0.001f, 0.001f), vec2<f32>(0.999f, 0.999f));
}

fn sampleRevolve(uv_3: ptr<function, vec2<f32>>, t_2: ptr<function, f32>) -> vec4<f32> {
    var p_2: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: f32;
    var reveal: f32;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;

    let _e54 = (*uv_3);
    param_7 = _e54;
    let _e55 = (*t_2);
    param_8 = _e55;
    let _e56 = warpUv((&param_7), (&param_8));
    p_2 = _e56;
    let _e58 = uniforms.switchStart;
    let _e60 = uniforms.switchEnd;
    let _e61 = (*t_2);
    reveal = smoothstep(_e58, _e60, _e61);
    let _e63 = p_2;
    param_9 = _e63;
    let _e64 = getFromColor((&param_9));
    let _e65 = p_2;
    param_10 = _e65;
    let _e66 = getToColor((&param_10));
    let _e67 = reveal;
    return mix(_e64, _e66, vec4(_e67));
}

fn transition(uv_4: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_11: vec2<f32>;
    var param_12: vec2<f32>;
    var e_1: f32;
    var param_13: f32;
    var span: f32;
    var color: vec4<f32>;
    var total: f32;
    var i: i32;
    var x_2: f32;
    var w: f32;
    var t_3: f32;
    var param_14: f32;
    var param_15: vec2<f32>;
    var param_16: f32;
    var q: vec2<f32>;
    var vignette: f32;

    let _e64 = uniforms.progress;
    if (_e64 <= 0f) {
        let _e66 = (*uv_4);
        param_11 = _e66;
        let _e67 = getFromColor((&param_11));
        return _e67;
    }
    let _e69 = uniforms.progress;
    if (_e69 >= 1f) {
        let _e71 = (*uv_4);
        param_12 = _e71;
        let _e72 = getToColor((&param_12));
        return _e72;
    }
    let _e74 = uniforms.progress;
    param_13 = _e74;
    let _e75 = revolveEnvelope((&param_13));
    e_1 = _e75;
    let _e77 = uniforms.motionBlur;
    let _e79 = e_1;
    span = ((0.06f * _e77) * _e79);
    color = vec4<f32>(0f, 0f, 0f, 0f);
    total = 0f;
    i = -8i;
    loop {
        let _e81 = i;
        if (_e81 <= 8i) {
            let _e83 = i;
            x_2 = (f32(_e83) / 8f);
            let _e86 = x_2;
            w = (1f - abs(_e86));
            let _e89 = w;
            let _e90 = w;
            w = ((_e89 * _e90) + 0.01f);
            let _e94 = uniforms.progress;
            let _e95 = x_2;
            let _e96 = span;
            param_14 = (_e94 + (_e95 * _e96));
            let _e99 = sat((&param_14));
            t_3 = _e99;
            let _e100 = (*uv_4);
            param_15 = _e100;
            let _e101 = t_3;
            param_16 = _e101;
            let _e102 = sampleRevolve((&param_15), (&param_16));
            let _e103 = w;
            let _e105 = color;
            color = (_e105 + (_e102 * _e103));
            let _e107 = w;
            let _e108 = total;
            total = (_e108 + _e107);
            continue;
        } else {
            break;
        }
        continuing {
            let _e110 = i;
            i = (_e110 + 1i);
        }
    }
    let _e112 = total;
    let _e113 = color;
    color = (_e113 / vec4(_e112));
    let _e116 = (*uv_4);
    q = (_e116 - vec2<f32>(0.5f, 0.5f));
    let _e119 = uniforms.ratio;
    let _e121 = q[0u];
    q[0u] = (_e121 * _e119);
    let _e125 = uniforms.shadow;
    let _e126 = e_1;
    let _e128 = q;
    vignette = (1f - ((_e125 * _e126) * smoothstep(0.35f, 0.95f, length(_e128))));
    let _e133 = vignette;
    let _e134 = color;
    let _e136 = (_e134.xyz * _e133);
    color[0u] = _e136.x;
    color[1u] = _e136.y;
    color[2u] = _e136.z;
    let _e143 = color;
    return _e143;
}

fn main_1() {
    var param_17: vec2<f32>;

    let _e47 = _uv_1;
    param_17 = _e47;
    let _e48 = transition((&param_17));
    _fragColor = _e48;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
