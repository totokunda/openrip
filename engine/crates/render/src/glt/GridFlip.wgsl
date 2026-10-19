// GridFlip — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/GridFlip.glsl
// Author: TimDonselaar
// License: MIT
// Description: The image splits into a grid of tiles that flip one by one to the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    size: vec2<i32>,
    pause: f32,
    dividerWidth: f32,
    bgcolor: vec4<f32>,
    randomness: f32,
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
    let _e24 = (*uv)[0u];
    let _e26 = (*uv)[1u];
    let _e29 = textureSampleLevel(_to, _sampler, vec2<f32>(_e24, (1f - _e26)), 0f);
    return _e29;
}

fn rand(co: ptr<function, vec2<f32>>) -> f32 {
    let _e23 = (*co);
    return fract((sin(dot(_e23, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e24 = (*uv_1)[0u];
    let _e26 = (*uv_1)[1u];
    let _e29 = textureSampleLevel(_from, _sampler, vec2<f32>(_e24, (1f - _e26)), 0f);
    return _e29;
}

fn getDividerSize_u0028_() -> f32 {
    var rectangleSize: vec2<f32>;

    let _e24 = uniforms.size;
    let _e29 = uniforms.size;
    rectangleSize = vec2<f32>((1f / vec2<f32>(_e24).x), (1f / vec2<f32>(_e29).y));
    let _e35 = rectangleSize[0u];
    let _e37 = rectangleSize[1u];
    let _e40 = uniforms.dividerWidth;
    return (min(_e35, _e37) * _e40);
}

fn getDelta(p: ptr<function, vec2<f32>>) -> f32 {
    var rectanglePos: vec2<f32>;
    var rectangleSize_1: vec2<f32>;
    var top: f32;
    var bottom: f32;
    var left: f32;
    var right: f32;
    var minX: f32;
    var minY: f32;

    let _e32 = uniforms.size;
    let _e34 = (*p);
    rectanglePos = floor((vec2<f32>(_e32) * _e34));
    let _e38 = uniforms.size;
    let _e43 = uniforms.size;
    rectangleSize_1 = vec2<f32>((1f / vec2<f32>(_e38).x), (1f / vec2<f32>(_e43).y));
    let _e49 = rectangleSize_1[1u];
    let _e51 = rectanglePos[1u];
    top = (_e49 * (_e51 + 1f));
    let _e55 = rectangleSize_1[1u];
    let _e57 = rectanglePos[1u];
    bottom = (_e55 * _e57);
    let _e60 = rectangleSize_1[0u];
    let _e62 = rectanglePos[0u];
    left = (_e60 * _e62);
    let _e65 = rectangleSize_1[0u];
    let _e67 = rectanglePos[0u];
    right = (_e65 * (_e67 + 1f));
    let _e71 = (*p)[0u];
    let _e72 = left;
    let _e76 = (*p)[0u];
    let _e77 = right;
    minX = min(abs((_e71 - _e72)), abs((_e76 - _e77)));
    let _e82 = (*p)[1u];
    let _e83 = top;
    let _e87 = (*p)[1u];
    let _e88 = bottom;
    minY = min(abs((_e82 - _e83)), abs((_e87 - _e88)));
    let _e92 = minX;
    let _e93 = minY;
    return min(_e92, _e93);
}

fn transition(p_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var currentProg: f32;
    var a: f32;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var currentProg_1: f32;
    var q: vec2<f32>;
    var rectanglePos_1: vec2<f32>;
    var r: f32;
    var param_3: vec2<f32>;
    var cp: f32;
    var rectangleSize_2: f32;
    var delta: f32;
    var offset: f32;
    var a_1: vec4<f32>;
    var param_4: vec2<f32>;
    var b: vec4<f32>;
    var param_5: vec2<f32>;
    var s: f32;
    var currentProg_2: f32;
    var a_2: f32;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;

    let _e47 = uniforms.progress;
    let _e49 = uniforms.pause;
    if (_e47 < _e49) {
        let _e52 = uniforms.progress;
        let _e54 = uniforms.pause;
        currentProg = (_e52 / _e54);
        a = 1f;
        let _e56 = (*p_1);
        param = _e56;
        let _e57 = getDelta((&param));
        let _e58 = getDividerSize_u0028_();
        if (_e57 < _e58) {
            let _e60 = currentProg;
            a = (1f - _e60);
        }
        let _e63 = uniforms.bgcolor;
        let _e64 = (*p_1);
        param_1 = _e64;
        let _e65 = getFromColor((&param_1));
        let _e66 = a;
        return mix(_e63, _e65, vec4(_e66));
    } else {
        let _e70 = uniforms.progress;
        let _e72 = uniforms.pause;
        if (_e70 < (1f - _e72)) {
            let _e75 = (*p_1);
            param_2 = _e75;
            let _e76 = getDelta((&param_2));
            let _e77 = getDividerSize_u0028_();
            if (_e76 < _e77) {
                let _e80 = uniforms.bgcolor;
                return _e80;
            } else {
                let _e82 = uniforms.progress;
                let _e84 = uniforms.pause;
                let _e87 = uniforms.pause;
                currentProg_1 = ((_e82 - _e84) / (1f - (_e87 * 2f)));
                let _e91 = (*p_1);
                q = _e91;
                let _e93 = uniforms.size;
                let _e95 = q;
                rectanglePos_1 = floor((vec2<f32>(_e93) * _e95));
                let _e98 = rectanglePos_1;
                param_3 = _e98;
                let _e99 = rand((&param_3));
                let _e101 = uniforms.randomness;
                r = (_e99 - _e101);
                let _e103 = r;
                let _e105 = currentProg_1;
                cp = smoothstep(0f, (1f - _e103), _e105);
                let _e108 = uniforms.size;
                rectangleSize_2 = (1f / vec2<f32>(_e108).x);
                let _e113 = rectanglePos_1[0u];
                let _e114 = rectangleSize_2;
                delta = (_e113 * _e114);
                let _e116 = rectangleSize_2;
                let _e118 = delta;
                offset = ((_e116 / 2f) + _e118);
                let _e121 = (*p_1)[0u];
                let _e122 = offset;
                let _e124 = cp;
                let _e129 = offset;
                (*p_1)[0u] = ((((_e121 - _e122) / abs((_e124 - 0.5f))) * 0.5f) + _e129);
                let _e132 = (*p_1);
                param_4 = _e132;
                let _e133 = getFromColor((&param_4));
                a_1 = _e133;
                let _e134 = (*p_1);
                param_5 = _e134;
                let _e135 = getToColor((&param_5));
                b = _e135;
                let _e137 = uniforms.size;
                let _e141 = q[0u];
                let _e142 = delta;
                let _e147 = cp;
                s = step(abs(((vec2<f32>(_e137).x * (_e141 - _e142)) - 0.5f)), abs((_e147 - 0.5f)));
                let _e152 = uniforms.bgcolor;
                let _e153 = b;
                let _e154 = a_1;
                let _e155 = cp;
                let _e159 = s;
                return mix(_e152, mix(_e153, _e154, vec4(step(_e155, 0.5f))), vec4(_e159));
            }
        } else {
            let _e163 = uniforms.progress;
            let _e166 = uniforms.pause;
            let _e169 = uniforms.pause;
            currentProg_2 = (((_e163 - 1f) + _e166) / _e169);
            a_2 = 1f;
            let _e171 = (*p_1);
            param_6 = _e171;
            let _e172 = getDelta((&param_6));
            let _e173 = getDividerSize_u0028_();
            if (_e172 < _e173) {
                let _e175 = currentProg_2;
                a_2 = _e175;
            }
            let _e177 = uniforms.bgcolor;
            let _e178 = (*p_1);
            param_7 = _e178;
            let _e179 = getToColor((&param_7));
            let _e180 = a_2;
            return mix(_e177, _e179, vec4(_e180));
        }
    }
}

fn main_1() {
    var param_8: vec2<f32>;

    let _e23 = _uv_1;
    param_8 = _e23;
    let _e24 = transition((&param_8));
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
