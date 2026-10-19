// GlitchMemories — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/GlitchMemories.glsl
// Author: Gunnar Roth
// License: MIT
// Description: A crossfade with glitchy, color-shifted blocks
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

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e25 = (*uv)[0u];
    let _e27 = (*uv)[1u];
    let _e30 = textureSampleLevel(_to, _sampler, vec2<f32>(_e25, (1f - _e27)), 0f);
    return _e30;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e25 = (*uv_1)[0u];
    let _e27 = (*uv_1)[1u];
    let _e30 = textureSampleLevel(_from, _sampler, vec2<f32>(_e25, (1f - _e27)), 0f);
    return _e30;
}

fn transition(p: ptr<function, vec2<f32>>) -> vec4<f32> {
    var block: vec2<f32>;
    var uv_noise: vec2<f32>;
    var dist: vec2<f32>;
    var local: vec2<f32>;
    var red: vec2<f32>;
    var green: vec2<f32>;
    var blue: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;

    let _e37 = (*p);
    block = floor((_e37 / vec2<f32>(16f, 16f)));
    let _e40 = block;
    uv_noise = (_e40 / vec2<f32>(64f, 64f));
    let _e43 = uniforms.progress;
    let _e48 = uv_noise;
    uv_noise = (_e48 + (floor((vec2(_e43) * vec2<f32>(1200f, 3500f))) / vec2<f32>(64f, 64f)));
    let _e51 = uniforms.progress;
    if (_e51 > 0f) {
        let _e53 = uv_noise;
        let _e59 = uniforms.progress;
        local = (((fract(_e53) - vec2(0.5f)) * 0.3f) * (1f - _e59));
    } else {
        local = vec2<f32>(0f, 0f);
    }
    let _e62 = local;
    dist = _e62;
    let _e63 = (*p);
    let _e64 = dist;
    red = (_e63 + (_e64 * 0.2f));
    let _e67 = (*p);
    let _e68 = dist;
    green = (_e67 + (_e68 * 0.3f));
    let _e71 = (*p);
    let _e72 = dist;
    blue = (_e71 + (_e72 * 0.5f));
    let _e75 = red;
    param = _e75;
    let _e76 = getFromColor((&param));
    let _e77 = red;
    param_1 = _e77;
    let _e78 = getToColor((&param_1));
    let _e80 = uniforms.progress;
    let _e84 = green;
    param_2 = _e84;
    let _e85 = getFromColor((&param_2));
    let _e86 = green;
    param_3 = _e86;
    let _e87 = getToColor((&param_3));
    let _e89 = uniforms.progress;
    let _e93 = blue;
    param_4 = _e93;
    let _e94 = getFromColor((&param_4));
    let _e95 = blue;
    param_5 = _e95;
    let _e96 = getToColor((&param_5));
    let _e98 = uniforms.progress;
    return vec4<f32>(mix(_e76, _e78, vec4(_e80)).x, mix(_e85, _e87, vec4(_e89)).y, mix(_e94, _e96, vec4(_e98)).z, 1f);
}

fn main_1() {
    var param_6: vec2<f32>;

    let _e24 = _uv_1;
    param_6 = _e24;
    let _e25 = transition((&param_6));
    _fragColor = _e25;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
