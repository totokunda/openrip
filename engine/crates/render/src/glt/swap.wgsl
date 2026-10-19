// swap — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/swap.glsl
// Author: gre
// License: MIT
// Description: The two images swap places in 3D, with a floor reflection
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
    let _e32 = (*uv)[0u];
    let _e34 = (*uv)[1u];
    let _e37 = textureSampleLevel(_to, _sampler, vec2<f32>(_e32, (1f - _e34)), 0f);
    return _e37;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e32 = (*uv_1)[0u];
    let _e34 = (*uv_1)[1u];
    let _e37 = textureSampleLevel(_from, _sampler, vec2<f32>(_e32, (1f - _e34)), 0f);
    return _e37;
}

fn inBounds(p: ptr<function, vec2<f32>>) -> bool {
    var phi_84_: bool;

    let _e31 = (*p);
    let _e33 = all((vec2<f32>(0f, 0f) < _e31));
    phi_84_ = _e33;
    if _e33 {
        let _e34 = (*p);
        phi_84_ = all((_e34 < vec2<f32>(1f, 1f)));
    }
    let _e38 = phi_84_;
    return _e38;
}

fn project(p_1: ptr<function, vec2<f32>>) -> vec2<f32> {
    let _e31 = (*p_1);
    return ((_e31 * vec2<f32>(1f, -1.2f)) + vec2<f32>(0f, -0.02f));
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
    let _e40 = (*pfr);
    param = _e40;
    let _e41 = project((&param));
    (*pfr) = _e41;
    let _e42 = (*pfr);
    param_1 = _e42;
    let _e43 = inBounds((&param_1));
    if _e43 {
        let _e44 = (*pfr);
        param_2 = _e44;
        let _e45 = getFromColor((&param_2));
        let _e47 = uniforms.reflection;
        let _e49 = (*pfr)[1u];
        let _e54 = c;
        c = (_e54 + mix(vec4<f32>(0f, 0f, 0f, 1f), _e45, vec4((_e47 * mix(1f, 0f, _e49)))));
    }
    let _e56 = (*pto);
    param_3 = _e56;
    let _e57 = project((&param_3));
    (*pto) = _e57;
    let _e58 = (*pto);
    param_4 = _e58;
    let _e59 = inBounds((&param_4));
    if _e59 {
        let _e60 = (*pto);
        param_5 = _e60;
        let _e61 = getToColor((&param_5));
        let _e63 = uniforms.reflection;
        let _e65 = (*pto)[1u];
        let _e70 = c;
        c = (_e70 + mix(vec4<f32>(0f, 0f, 0f, 1f), _e61, vec4((_e63 * mix(1f, 0f, _e65)))));
    }
    let _e72 = c;
    return _e72;
}

fn transition(p_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var pto_1: vec2<f32>;
    var size: f32;
    var persp: f32;
    var pfr_1: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;
    var param_11: vec2<f32>;
    var param_12: vec2<f32>;
    var param_13: vec2<f32>;
    var param_14: vec2<f32>;
    var param_15: vec2<f32>;
    var param_16: vec2<f32>;

    pto_1 = vec2<f32>(-1f, -1f);
    let _e47 = uniforms.depth;
    let _e49 = uniforms.progress;
    size = mix(1f, _e47, _e49);
    let _e52 = uniforms.perspective;
    let _e54 = uniforms.progress;
    persp = (_e52 * _e54);
    let _e56 = (*p_3);
    let _e58 = size;
    let _e60 = uniforms.perspective;
    let _e62 = uniforms.progress;
    let _e66 = size;
    let _e67 = size;
    let _e68 = persp;
    let _e71 = (*p_3)[0u];
    pfr_1 = (((_e56 + vec2<f32>(-0f, -0.5f)) * vec2<f32>((_e58 / (1f - (_e60 * _e62))), (_e66 / (1f - ((_e67 * _e68) * _e71))))) + vec2<f32>(0f, 0.5f));
    let _e79 = uniforms.depth;
    let _e81 = uniforms.progress;
    size = mix(1f, _e79, (1f - _e81));
    let _e85 = uniforms.perspective;
    let _e87 = uniforms.progress;
    persp = (_e85 * (1f - _e87));
    let _e90 = (*p_3);
    let _e92 = size;
    let _e94 = uniforms.perspective;
    let _e96 = uniforms.progress;
    let _e101 = size;
    let _e102 = size;
    let _e103 = persp;
    let _e106 = (*p_3)[0u];
    pto_1 = (((_e90 + vec2<f32>(-1f, -0.5f)) * vec2<f32>((_e92 / (1f - (_e94 * (1f - _e96)))), (_e101 / (1f - ((_e102 * _e103) * (0.5f - _e106)))))) + vec2<f32>(1f, 0.5f));
    let _e115 = uniforms.progress;
    if (_e115 < 0.5f) {
        let _e117 = pfr_1;
        param_6 = _e117;
        let _e118 = inBounds((&param_6));
        if _e118 {
            let _e119 = pfr_1;
            param_7 = _e119;
            let _e120 = getFromColor((&param_7));
            return _e120;
        }
        let _e121 = pto_1;
        param_8 = _e121;
        let _e122 = inBounds((&param_8));
        if _e122 {
            let _e123 = pto_1;
            param_9 = _e123;
            let _e124 = getToColor((&param_9));
            return _e124;
        }
    }
    let _e125 = pto_1;
    param_10 = _e125;
    let _e126 = inBounds((&param_10));
    if _e126 {
        let _e127 = pto_1;
        param_11 = _e127;
        let _e128 = getToColor((&param_11));
        return _e128;
    }
    let _e129 = pfr_1;
    param_12 = _e129;
    let _e130 = inBounds((&param_12));
    if _e130 {
        let _e131 = pfr_1;
        param_13 = _e131;
        let _e132 = getFromColor((&param_13));
        return _e132;
    }
    let _e133 = (*p_3);
    param_14 = _e133;
    let _e134 = pfr_1;
    param_15 = _e134;
    let _e135 = pto_1;
    param_16 = _e135;
    let _e136 = bgColor((&param_14), (&param_15), (&param_16));
    return _e136;
}

fn main_1() {
    var param_17: vec2<f32>;

    let _e31 = _uv_1;
    param_17 = _e31;
    let _e32 = transition((&param_17));
    _fragColor = _e32;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
