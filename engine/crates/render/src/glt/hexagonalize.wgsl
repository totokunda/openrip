// hexagonalize — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/hexagonalize.glsl
// Author: Fernando Kuteken
// License: MIT
// Description: Both images turn into hexagons, crossfade, then sharpen again
// Bindings and uniform layout: see the gl-transitions package README

struct Hexagon {
    q: f32,
    r: f32,
    s: f32,
}

struct Uniforms {
    progress: f32,
    ratio: f32,
    steps: i32,
    horizontalHexagons: f32,
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

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e24 = (*uv_1)[0u];
    let _e26 = (*uv_1)[1u];
    let _e29 = textureSampleLevel(_from, _sampler, vec2<f32>(_e24, (1f - _e26)), 0f);
    return _e29;
}

fn pointFromHexagon(hex: ptr<function, Hexagon>, size: ptr<function, f32>) -> vec2<f32> {
    var x: f32;
    var y: f32;

    let _e27 = (*hex).q;
    let _e30 = (*hex).r;
    let _e33 = (*size);
    x = ((((1.7320508f * _e27) + (0.8660254f * _e30)) * _e33) + 0.5f);
    let _e37 = (*hex).q;
    let _e40 = (*hex).r;
    let _e43 = (*size);
    y = ((((0f * _e37) + (1.5f * _e40)) * _e43) + 0.5f);
    let _e46 = x;
    let _e47 = y;
    let _e49 = uniforms.ratio;
    return vec2<f32>(_e46, (_e47 * _e49));
}

fn createHexagon(q: ptr<function, f32>, r: ptr<function, f32>) -> Hexagon {
    var hex_1: Hexagon;

    let _e25 = (*q);
    hex_1.q = _e25;
    let _e27 = (*r);
    hex_1.r = _e27;
    let _e29 = (*q);
    let _e31 = (*r);
    hex_1.s = (-(_e29) - _e31);
    let _e34 = hex_1;
    return _e34;
}

fn roundHexagon(hex_2: ptr<function, Hexagon>) -> Hexagon {
    var q_1: f32;
    var r_1: f32;
    var s: f32;
    var deltaQ: f32;
    var deltaR: f32;
    var deltaS: f32;
    var param: f32;
    var param_1: f32;

    let _e32 = (*hex_2).q;
    q_1 = floor((_e32 + 0.5f));
    let _e36 = (*hex_2).r;
    r_1 = floor((_e36 + 0.5f));
    let _e40 = (*hex_2).s;
    s = floor((_e40 + 0.5f));
    let _e43 = q_1;
    let _e45 = (*hex_2).q;
    deltaQ = abs((_e43 - _e45));
    let _e48 = r_1;
    let _e50 = (*hex_2).r;
    deltaR = abs((_e48 - _e50));
    let _e53 = s;
    let _e55 = (*hex_2).s;
    deltaS = abs((_e53 - _e55));
    let _e58 = deltaQ;
    let _e59 = deltaR;
    let _e61 = deltaQ;
    let _e62 = deltaS;
    if ((_e58 > _e59) && (_e61 > _e62)) {
        let _e65 = r_1;
        let _e67 = s;
        q_1 = (-(_e65) - _e67);
    } else {
        let _e69 = deltaR;
        let _e70 = deltaS;
        if (_e69 > _e70) {
            let _e72 = q_1;
            let _e74 = s;
            r_1 = (-(_e72) - _e74);
        } else {
            let _e76 = q_1;
            let _e78 = r_1;
            s = (-(_e76) - _e78);
        }
    }
    let _e80 = q_1;
    param = _e80;
    let _e81 = r_1;
    param_1 = _e81;
    let _e82 = createHexagon((&param), (&param_1));
    return _e82;
}

fn hexagonFromPoint(point: ptr<function, vec2<f32>>, size_1: ptr<function, f32>) -> Hexagon {
    var q_2: f32;
    var r_2: f32;
    var hex_3: Hexagon;
    var param_2: f32;
    var param_3: f32;
    var param_4: Hexagon;

    let _e31 = uniforms.ratio;
    let _e33 = (*point)[1u];
    (*point)[1u] = (_e33 / _e31);
    let _e36 = (*point);
    let _e39 = (*size_1);
    (*point) = ((_e36 - vec2(0.5f)) / vec2(_e39));
    let _e43 = (*point)[0u];
    let _e46 = (*point)[1u];
    q_2 = ((0.57735026f * _e43) + (-0.33333334f * _e46));
    let _e50 = (*point)[0u];
    let _e53 = (*point)[1u];
    r_2 = ((0f * _e50) + (0.6666667f * _e53));
    let _e56 = q_2;
    param_2 = _e56;
    let _e57 = r_2;
    param_3 = _e57;
    let _e58 = createHexagon((&param_2), (&param_3));
    hex_3 = _e58;
    let _e59 = hex_3;
    param_4 = _e59;
    let _e60 = roundHexagon((&param_4));
    return _e60;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var dist: f32;
    var local: f32;
    var size_2: f32;
    var point_1: vec2<f32>;
    var local_1: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: f32;
    var param_7: Hexagon;
    var param_8: f32;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;

    let _e35 = uniforms.progress;
    let _e37 = uniforms.progress;
    dist = (2f * min(_e35, (1f - _e37)));
    let _e42 = uniforms.steps;
    if (_e42 > 0i) {
        let _e44 = dist;
        let _e46 = uniforms.steps;
        let _e51 = uniforms.steps;
        local = (ceil((_e44 * f32(_e46))) / f32(_e51));
    } else {
        let _e54 = dist;
        local = _e54;
    }
    let _e55 = local;
    dist = _e55;
    let _e56 = dist;
    let _e59 = uniforms.horizontalHexagons;
    size_2 = ((0.57735026f * _e56) / _e59);
    let _e61 = dist;
    if (_e61 > 0f) {
        let _e63 = (*uv_2);
        param_5 = _e63;
        let _e64 = size_2;
        param_6 = _e64;
        let _e65 = hexagonFromPoint((&param_5), (&param_6));
        param_7 = _e65;
        let _e66 = size_2;
        param_8 = _e66;
        let _e67 = pointFromHexagon((&param_7), (&param_8));
        local_1 = _e67;
    } else {
        let _e68 = (*uv_2);
        local_1 = _e68;
    }
    let _e69 = local_1;
    point_1 = _e69;
    let _e70 = point_1;
    param_9 = _e70;
    let _e71 = getFromColor((&param_9));
    let _e72 = point_1;
    param_10 = _e72;
    let _e73 = getToColor((&param_10));
    let _e75 = uniforms.progress;
    return mix(_e71, _e73, vec4(_e75));
}

fn main_1() {
    var param_11: vec2<f32>;

    let _e23 = _uv_1;
    param_11 = _e23;
    let _e24 = transition((&param_11));
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
