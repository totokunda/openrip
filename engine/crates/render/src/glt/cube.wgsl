// cube — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/cube.glsl
// Author: gre
// License: MIT
// Description: The two images are faces of a rotating 3D cube, with a floor reflection
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    persp: f32,
    unzoom: f32,
    reflection: f32,
    floating: f32,
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

fn inBounds(p: ptr<function, vec2<f32>>) -> bool {
    var phi_109_: bool;

    let _e26 = (*p);
    let _e28 = all((vec2<f32>(0f, 0f) < _e26));
    phi_109_ = _e28;
    if _e28 {
        let _e29 = (*p);
        phi_109_ = all((_e29 < vec2<f32>(1f, 1f)));
    }
    let _e33 = phi_109_;
    return _e33;
}

fn project(p_1: ptr<function, vec2<f32>>) -> vec2<f32> {
    let _e26 = (*p_1);
    let _e29 = uniforms.floating;
    return ((_e26 * vec2<f32>(1f, -1.2f)) + vec2<f32>(0f, (-(_e29) / 100f)));
}

fn bgColor(p_2: ptr<function, vec2<f32>>, pfr: ptr<function, vec2<f32>>, pto: ptr<function, vec2<f32>>) -> vec4<f32> {
    var c: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;

    c = vec4<f32>(0f, 0f, 0f, 1f);
    let _e35 = (*pfr);
    param = _e35;
    let _e36 = project((&param));
    (*pfr) = _e36;
    let _e37 = (*pfr);
    param_1 = _e37;
    let _e38 = inBounds((&param_1));
    if _e38 {
        let _e39 = (*pfr);
        param_2 = _e39;
        let _e40 = getFromColor((&param_2));
        let _e42 = uniforms.reflection;
        let _e44 = (*pfr)[1u];
        let _e49 = c;
        c = (_e49 + mix(vec4<f32>(0f, 0f, 0f, 0f), _e40, vec4((_e42 * mix(1f, 0f, _e44)))));
    }
    let _e51 = (*pto);
    param_3 = _e51;
    let _e52 = project((&param_3));
    (*pto) = _e52;
    let _e53 = (*pto);
    param_4 = _e53;
    let _e54 = inBounds((&param_4));
    if _e54 {
        let _e55 = (*pto);
        param_5 = _e55;
        let _e56 = getToColor((&param_5));
        let _e58 = uniforms.reflection;
        let _e60 = (*pto)[1u];
        let _e65 = c;
        c = (_e65 + mix(vec4<f32>(0f, 0f, 0f, 0f), _e56, vec4((_e58 * mix(1f, 0f, _e60)))));
    }
    let _e67 = c;
    return _e67;
}

fn xskew(p_3: ptr<function, vec2<f32>>, persp: ptr<function, f32>, center: ptr<function, f32>) -> vec2<f32> {
    var x: f32;

    let _e30 = (*p_3)[0u];
    let _e32 = (*p_3)[0u];
    let _e34 = (*center);
    x = mix(_e30, (1f - _e32), _e34);
    let _e36 = x;
    let _e38 = (*p_3)[1u];
    let _e39 = (*persp);
    let _e42 = x;
    let _e45 = (*persp);
    let _e47 = x;
    let _e52 = (*center);
    let _e57 = (*center);
    let _e60 = (*center);
    let _e66 = (*center);
    return (((vec2<f32>(_e36, ((_e38 - ((0.5f * (1f - _e39)) * _e42)) / (1f + ((_e45 - 1f) * _e47)))) - vec2<f32>((0.5f - distance(_e52, 0.5f)), 0f)) * vec2<f32>(((0.5f / distance(_e57, 0.5f)) * select(-1f, 1f, (_e60 < 0.5f))), 1f)) + vec2<f32>(select(1f, 0f, (_e66 < 0.5f)), 0f));
}

fn transition(op: ptr<function, vec2<f32>>) -> vec4<f32> {
    var uz: f32;
    var p_4: vec2<f32>;
    var fromP: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: f32;
    var param_8: f32;
    var toP: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: f32;
    var param_11: f32;
    var param_12: vec2<f32>;
    var param_13: vec2<f32>;
    var param_14: vec2<f32>;
    var param_15: vec2<f32>;
    var param_16: vec2<f32>;
    var param_17: vec2<f32>;
    var param_18: vec2<f32>;

    let _e44 = uniforms.unzoom;
    let _e47 = uniforms.progress;
    uz = ((_e44 * 2f) * (0.5f - distance(0.5f, _e47)));
    let _e51 = uz;
    let _e54 = uz;
    let _e56 = (*op);
    p_4 = (vec2((-(_e51) * 0.5f)) + (_e56 * (1f + _e54)));
    let _e60 = p_4;
    let _e62 = uniforms.progress;
    let _e66 = uniforms.progress;
    let _e71 = uniforms.progress;
    let _e73 = uniforms.persp;
    param_6 = ((_e60 - vec2<f32>(_e62, 0f)) / vec2<f32>((1f - _e66), 1f));
    param_7 = (1f - mix(_e71, 0f, _e73));
    param_8 = 0f;
    let _e76 = xskew((&param_6), (&param_7), (&param_8));
    fromP = _e76;
    let _e77 = p_4;
    let _e79 = uniforms.progress;
    let _e83 = uniforms.progress;
    let _e86 = uniforms.persp;
    param_9 = (_e77 / vec2<f32>(_e79, 1f));
    param_10 = mix(pow(_e83, 2f), 1f, _e86);
    param_11 = 1f;
    let _e88 = xskew((&param_9), (&param_10), (&param_11));
    toP = _e88;
    let _e89 = fromP;
    param_12 = _e89;
    let _e90 = inBounds((&param_12));
    if _e90 {
        let _e91 = fromP;
        param_13 = _e91;
        let _e92 = getFromColor((&param_13));
        return _e92;
    } else {
        let _e93 = toP;
        param_14 = _e93;
        let _e94 = inBounds((&param_14));
        if _e94 {
            let _e95 = toP;
            param_15 = _e95;
            let _e96 = getToColor((&param_15));
            return _e96;
        }
    }
    let _e97 = (*op);
    param_16 = _e97;
    let _e98 = fromP;
    param_17 = _e98;
    let _e99 = toP;
    param_18 = _e99;
    let _e100 = bgColor((&param_16), (&param_17), (&param_18));
    return _e100;
}

fn main_1() {
    var param_19: vec2<f32>;

    let _e26 = _uv_1;
    param_19 = _e26;
    let _e27 = transition((&param_19));
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
