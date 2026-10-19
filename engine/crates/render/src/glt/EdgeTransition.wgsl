// EdgeTransition — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/EdgeTransition.glsl
// Author: Woohyun Kim
// License: MIT
// Description: Both images fade through black with their edges glowing
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    edge_thickness: f32,
    edge_brightness: f32,
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

fn detectEdgeColor(c: ptr<function, array<vec3<f32>, 9>>) -> vec4<f32> {
    var dx: vec3<f32>;
    var dy: vec3<f32>;
    var delta: f32;

    let _e28 = (*c)[7i];
    let _e30 = (*c)[1i];
    let _e35 = (*c)[2i];
    let _e37 = (*c)[6i];
    let _e42 = (*c)[8i];
    let _e44 = (*c)[0i];
    dx = (((abs((_e28 - _e30)) * 2f) + abs((_e35 - _e37))) + abs((_e42 - _e44)));
    let _e49 = (*c)[3i];
    let _e51 = (*c)[5i];
    let _e56 = (*c)[6i];
    let _e58 = (*c)[8i];
    let _e63 = (*c)[0i];
    let _e65 = (*c)[2i];
    dy = (((abs((_e49 - _e51)) * 2f) + abs((_e56 - _e58))) + abs((_e63 - _e65)));
    let _e69 = dx;
    let _e70 = dy;
    delta = length((((_e69 + _e70) * 0.25f) * 0.5f));
    let _e76 = uniforms.edge_brightness;
    let _e77 = delta;
    let _e81 = (*c)[4i];
    let _e82 = (_e81 * clamp((_e76 * _e77), 0f, 1f));
    return vec4<f32>(_e82.x, _e82.y, _e82.z, 1f);
}

fn getToEdgeColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var i: i32;
    var j: i32;
    var color: vec4<f32>;
    var param: vec2<f32>;
    var c_1: array<vec3<f32>, 9>;
    var param_1: array<vec3<f32>, 9>;

    i = 0i;
    loop {
        let _e30 = i;
        if (_e30 < 3i) {
            j = 0i;
            loop {
                let _e32 = j;
                if (_e32 < 3i) {
                    let _e34 = (*uv_1);
                    let _e36 = uniforms.edge_thickness;
                    let _e37 = i;
                    let _e40 = j;
                    param = (_e34 + (vec2<f32>(f32((_e37 - 1i)), f32((_e40 - 1i))) * _e36));
                    let _e46 = getToColor((&param));
                    color = _e46;
                    let _e47 = i;
                    let _e49 = j;
                    let _e51 = color;
                    c_1[((3i * _e47) + _e49)] = _e51.xyz;
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e54 = j;
                    j = (_e54 + 1i);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e56 = i;
            i = (_e56 + 1i);
        }
    }
    let _e58 = c_1;
    param_1 = _e58;
    let _e59 = detectEdgeColor((&param_1));
    return _e59;
}

fn getFromColor(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e25 = (*uv_2)[0u];
    let _e27 = (*uv_2)[1u];
    let _e30 = textureSampleLevel(_from, _sampler, vec2<f32>(_e25, (1f - _e27)), 0f);
    return _e30;
}

fn getFromEdgeColor(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    var i_1: i32;
    var j_1: i32;
    var color_1: vec4<f32>;
    var param_2: vec2<f32>;
    var c_2: array<vec3<f32>, 9>;
    var param_3: array<vec3<f32>, 9>;

    i_1 = 0i;
    loop {
        let _e30 = i_1;
        if (_e30 < 3i) {
            j_1 = 0i;
            loop {
                let _e32 = j_1;
                if (_e32 < 3i) {
                    let _e34 = (*uv_3);
                    let _e36 = uniforms.edge_thickness;
                    let _e37 = i_1;
                    let _e40 = j_1;
                    param_2 = (_e34 + (vec2<f32>(f32((_e37 - 1i)), f32((_e40 - 1i))) * _e36));
                    let _e46 = getFromColor((&param_2));
                    color_1 = _e46;
                    let _e47 = i_1;
                    let _e49 = j_1;
                    let _e51 = color_1;
                    c_2[((3i * _e47) + _e49)] = _e51.xyz;
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e54 = j_1;
                    j_1 = (_e54 + 1i);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e56 = i_1;
            i_1 = (_e56 + 1i);
        }
    }
    let _e58 = c_2;
    param_3 = _e58;
    let _e59 = detectEdgeColor((&param_3));
    return _e59;
}

fn transition(uv_4: ptr<function, vec2<f32>>) -> vec4<f32> {
    var start: vec4<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var end: vec4<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;

    let _e30 = (*uv_4);
    param_4 = _e30;
    let _e31 = getFromColor((&param_4));
    let _e32 = (*uv_4);
    param_5 = _e32;
    let _e33 = getFromEdgeColor((&param_5));
    let _e35 = uniforms.progress;
    start = mix(_e31, _e33, vec4(clamp((2f * _e35), 0f, 1f)));
    let _e40 = (*uv_4);
    param_6 = _e40;
    let _e41 = getToEdgeColor((&param_6));
    let _e42 = (*uv_4);
    param_7 = _e42;
    let _e43 = getToColor((&param_7));
    let _e45 = uniforms.progress;
    end = mix(_e41, _e43, vec4(clamp((2f * (_e45 - 0.5f)), 0f, 1f)));
    let _e51 = start;
    let _e52 = end;
    let _e54 = uniforms.progress;
    return mix(_e51, _e52, vec4(_e54));
}

fn main_1() {
    var param_8: vec2<f32>;

    let _e24 = _uv_1;
    param_8 = _e24;
    let _e25 = transition((&param_8));
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
