// StarWipe — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/StarWipe.glsl
// Author: Ben Lucas
// License: MIT
// Description: A growing star reveals the incoming image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    border_thickness: f32,
    star_rotation: f32,
    border_color: vec4<f32>,
    star_center: vec2<f32>,
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
    let _e23 = (*uv)[0u];
    let _e25 = (*uv)[1u];
    let _e28 = textureSampleLevel(_from, _sampler, vec2<f32>(_e23, (1f - _e25)), 0f);
    return _e28;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e23 = (*uv_1)[0u];
    let _e25 = (*uv_1)[1u];
    let _e28 = textureSampleLevel(_to, _sampler, vec2<f32>(_e23, (1f - _e25)), 0f);
    return _e28;
}

fn rotate(v: ptr<function, vec2<f32>>, theta: ptr<function, f32>) -> vec2<f32> {
    var cosTheta: f32;
    var sinTheta: f32;

    let _e25 = (*theta);
    cosTheta = cos(_e25);
    let _e27 = (*theta);
    sinTheta = sin(_e27);
    let _e29 = cosTheta;
    let _e31 = (*v)[0u];
    let _e33 = sinTheta;
    let _e35 = (*v)[1u];
    let _e38 = sinTheta;
    let _e40 = (*v)[0u];
    let _e42 = cosTheta;
    let _e44 = (*v)[1u];
    return vec2<f32>(((_e29 * _e31) - (_e33 * _e35)), ((_e38 * _e40) + (_e42 * _e44)));
}

fn inStar(uv_2: ptr<function, vec2<f32>>, center: ptr<function, vec2<f32>>, radius: ptr<function, f32>) -> bool {
    var uv_centered: vec2<f32>;
    var param: vec2<f32>;
    var param_1: f32;
    var theta_1: f32;
    var uv_rotated: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: f32;
    var slope: f32;

    let _e32 = (*uv_2);
    let _e33 = (*center);
    uv_centered = (_e32 - _e33);
    let _e36 = uniforms.star_rotation;
    let _e38 = uv_centered;
    param = _e38;
    param_1 = (_e36 * 1.2566371f);
    let _e39 = rotate((&param), (&param_1));
    uv_centered = _e39;
    let _e41 = uv_centered[1u];
    let _e43 = uv_centered[0u];
    theta_1 = (atan2(_e41, _e43) + 3.1415927f);
    let _e46 = theta_1;
    let _e51 = uv_centered;
    param_2 = _e51;
    param_3 = (-1.2566371f * (floor((_e46 / 1.2566371f)) + 0.5f));
    let _e52 = rotate((&param_2), (&param_3));
    uv_rotated = _e52;
    slope = 0.3f;
    let _e54 = uv_rotated[1u];
    if (_e54 > 0f) {
        let _e56 = (*radius);
        let _e58 = uv_rotated[0u];
        let _e59 = slope;
        let _e63 = uv_rotated[1u];
        return ((_e56 + (_e58 * _e59)) > _e63);
    } else {
        let _e65 = (*radius);
        let _e68 = uv_rotated[0u];
        let _e69 = slope;
        let _e73 = uv_rotated[1u];
        return ((-(_e65) - (_e68 * _e69)) < _e73);
    }
}

fn transition(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var progressScaled: f32;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: f32;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: f32;
    var param_11: vec2<f32>;

    let _e32 = uniforms.border_thickness;
    let _e36 = uniforms.progress;
    let _e39 = uniforms.border_thickness;
    progressScaled = ((((2f * _e32) + 1f) * _e36) - _e39);
    let _e41 = (*uv_3);
    param_4 = _e41;
    let _e43 = uniforms.star_center;
    param_5 = _e43;
    let _e44 = progressScaled;
    param_6 = _e44;
    let _e45 = inStar((&param_4), (&param_5), (&param_6));
    if _e45 {
        let _e46 = (*uv_3);
        param_7 = _e46;
        let _e47 = getToColor((&param_7));
        return _e47;
    } else {
        let _e48 = progressScaled;
        let _e50 = uniforms.border_thickness;
        let _e52 = (*uv_3);
        param_8 = _e52;
        let _e54 = uniforms.star_center;
        param_9 = _e54;
        param_10 = (_e48 + _e50);
        let _e55 = inStar((&param_8), (&param_9), (&param_10));
        if _e55 {
            let _e57 = uniforms.border_color;
            return _e57;
        } else {
            let _e58 = (*uv_3);
            param_11 = _e58;
            let _e59 = getFromColor((&param_11));
            return _e59;
        }
    }
}

fn main_1() {
    var param_12: vec2<f32>;

    let _e22 = _uv_1;
    param_12 = _e22;
    let _e23 = transition((&param_12));
    _fragColor = _e23;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
