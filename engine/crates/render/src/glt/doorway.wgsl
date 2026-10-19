// doorway — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/doorway.glsl
// Author: gre
// License: MIT
// Description: The outgoing image opens like double doors as the incoming one comes forward, with a floor reflection
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    reflection: f32,
    perspective: f32,
    depth: f32,
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

fn inBounds(p: ptr<function, vec2<f32>>) -> bool {
    var phi_83_: bool;

    let _e29 = (*p);
    let _e31 = all((vec2<f32>(0f, 0f) < _e29));
    phi_83_ = _e31;
    if _e31 {
        let _e32 = (*p);
        phi_83_ = all((_e32 < vec2<f32>(1f, 1f)));
    }
    let _e36 = phi_83_;
    return _e36;
}

fn project(p_1: ptr<function, vec2<f32>>) -> vec2<f32> {
    let _e29 = (*p_1);
    return ((_e29 * vec2<f32>(1f, -1.2f)) + vec2<f32>(0f, -0.02f));
}

fn bgColor(p_2: ptr<function, vec2<f32>>, pto: ptr<function, vec2<f32>>) -> vec4<f32> {
    var c: vec4<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;

    c = vec4<f32>(0f, 0f, 0f, 1f);
    let _e34 = (*pto);
    param = _e34;
    let _e35 = project((&param));
    (*pto) = _e35;
    let _e36 = (*pto);
    param_1 = _e36;
    let _e37 = inBounds((&param_1));
    if _e37 {
        let _e38 = (*pto);
        param_2 = _e38;
        let _e39 = getToColor((&param_2));
        let _e41 = uniforms.reflection;
        let _e43 = (*pto)[1u];
        let _e48 = c;
        c = (_e48 + mix(vec4<f32>(0f, 0f, 0f, 1f), _e39, vec4((_e41 * mix(1f, 0f, _e43)))));
    }
    let _e50 = c;
    return _e50;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e30 = (*uv_1)[0u];
    let _e32 = (*uv_1)[1u];
    let _e35 = textureSampleLevel(_from, _sampler, vec2<f32>(_e30, (1f - _e32)), 0f);
    return _e35;
}

fn transition(p_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var pfr: vec2<f32>;
    var pto_1: vec2<f32>;
    var middleSlit: f32;
    var d: f32;
    var size: f32;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;

    pfr = vec2<f32>(-1f, -1f);
    pto_1 = vec2<f32>(-1f, -1f);
    let _e41 = (*p_3)[0u];
    let _e46 = uniforms.progress;
    middleSlit = ((2f * abs((_e41 - 0.5f))) - _e46);
    let _e48 = middleSlit;
    if (_e48 > 0f) {
        let _e50 = (*p_3);
        let _e52 = (*p_3)[0u];
        let _e56 = uniforms.progress;
        pfr = (_e50 + (vec2<f32>((0.5f * _e56), 0f) * select(1f, -1f, (_e52 > 0.5f))));
        let _e62 = uniforms.perspective;
        let _e64 = uniforms.progress;
        let _e66 = middleSlit;
        d = (1f / (1f + ((_e62 * _e64) * (1f - _e66))));
        let _e71 = d;
        let _e74 = pfr[1u];
        pfr[1u] = (_e74 - (_e71 / 2f));
        let _e77 = d;
        let _e79 = pfr[1u];
        pfr[1u] = (_e79 * _e77);
        let _e82 = d;
        let _e85 = pfr[1u];
        pfr[1u] = (_e85 + (_e82 / 2f));
    }
    let _e89 = uniforms.depth;
    let _e91 = uniforms.progress;
    size = mix(1f, _e89, (1f - _e91));
    let _e94 = (*p_3);
    let _e96 = size;
    pto_1 = (((_e94 + vec2<f32>(-0.5f, -0.5f)) * vec2(_e96)) + vec2<f32>(0.5f, 0.5f));
    let _e100 = pfr;
    param_3 = _e100;
    let _e101 = inBounds((&param_3));
    if _e101 {
        let _e102 = pfr;
        param_4 = _e102;
        let _e103 = getFromColor((&param_4));
        return _e103;
    } else {
        let _e104 = pto_1;
        param_5 = _e104;
        let _e105 = inBounds((&param_5));
        if _e105 {
            let _e106 = pto_1;
            param_6 = _e106;
            let _e107 = getToColor((&param_6));
            return _e107;
        } else {
            let _e108 = (*p_3);
            param_7 = _e108;
            let _e109 = pto_1;
            param_8 = _e109;
            let _e110 = bgColor((&param_7), (&param_8));
            return _e110;
        }
    }
}

fn main_1() {
    var param_9: vec2<f32>;

    let _e29 = _uv_1;
    param_9 = _e29;
    let _e30 = transition((&param_9));
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
