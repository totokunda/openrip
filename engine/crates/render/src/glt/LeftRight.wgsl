// LeftRight — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/LeftRight.glsl
// Author: zhmy
// License: MIT
// Description: The outgoing image shrinks away to the left while the incoming one slides in from the right
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

fn getFromColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e24 = (*uv)[0u];
    let _e26 = (*uv)[1u];
    let _e29 = textureSampleLevel(_from, _sampler, vec2<f32>(_e24, (1f - _e26)), 0f);
    return _e29;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e24 = (*uv_1)[0u];
    let _e26 = (*uv_1)[1u];
    let _e29 = textureSampleLevel(_to, _sampler, vec2<f32>(_e24, (1f - _e26)), 0f);
    return _e29;
}

fn inBounds(p: ptr<function, vec2<f32>>) -> bool {
    var phi_74_: bool;

    let _e23 = (*p);
    let _e25 = all((vec2<f32>(0f, 0f) < _e23));
    phi_74_ = _e25;
    if _e25 {
        let _e26 = (*p);
        phi_74_ = all((_e26 < vec2<f32>(1f, 1f)));
    }
    let _e30 = phi_74_;
    return _e30;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var spto: vec2<f32>;
    var size: f32;
    var spfr: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;

    spto = vec2<f32>(-1f, -1f);
    let _e31 = uniforms.progress;
    size = mix(1f, 3f, (_e31 * 0.2f));
    let _e34 = (*uv_2);
    let _e36 = size;
    spto = (((_e34 + vec2<f32>(-0.5f, -0.5f)) * vec2(_e36)) + vec2<f32>(0.5f, 0.5f));
    let _e40 = (*uv_2);
    let _e42 = uniforms.progress;
    spfr = (_e40 - vec2<f32>((1f - _e42), 0f));
    let _e46 = spfr;
    param = _e46;
    let _e47 = inBounds((&param));
    if _e47 {
        let _e48 = spfr;
        param_1 = _e48;
        let _e49 = getToColor((&param_1));
        return _e49;
    } else {
        let _e50 = spto;
        param_2 = _e50;
        let _e51 = inBounds((&param_2));
        if _e51 {
            let _e52 = spto;
            param_3 = _e52;
            let _e53 = getFromColor((&param_3));
            let _e55 = uniforms.progress;
            return (_e53 * (1f - _e55));
        } else {
            return vec4<f32>(0f, 0f, 0f, 1f);
        }
    }
}

fn main_1() {
    var param_4: vec2<f32>;

    let _e23 = _uv_1;
    param_4 = _e23;
    let _e24 = transition((&param_4));
    _fragColor = _e24;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
