// luminance_melt — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/luminance_melt.glsl
// Author: 0gust1
// License: MIT
// Description: The outgoing image melts away in noisy vertical streaks, depending on its brightness
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    direction: i32,
    l_threshold: f32,
    above: i32,
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

fn luminance(color: ptr<function, vec4<f32>>) -> f32 {
    let _e44 = (*color)[0u];
    let _e47 = (*color)[1u];
    let _e51 = (*color)[2u];
    return (((_e44 * 0.299f) + (_e47 * 0.587f)) + (_e51 * 0.114f));
}

fn rand(co: ptr<function, vec2<f32>>) -> f32 {
    let _e43 = (*co);
    return fract((sin(dot(_e43, vec2<f32>(12.9898f, 78.233f))) * 43758.547f));
}

fn mod289_u0028_vf3_u003b(x: ptr<function, vec3<f32>>) -> vec3<f32> {
    let _e43 = (*x);
    let _e44 = (*x);
    return (_e43 - (floor((_e44 * 0.0034602077f)) * 289f));
}

fn permute(x_1: ptr<function, vec3<f32>>) -> vec3<f32> {
    var param: vec3<f32>;

    let _e44 = (*x_1);
    let _e48 = (*x_1);
    param = (((_e44 * 34f) + vec3(1f)) * _e48);
    let _e50 = mod289_u0028_vf3_u003b((&param));
    return _e50;
}

fn mod289_u0028_vf2_u003b(x_2: ptr<function, vec2<f32>>) -> vec2<f32> {
    let _e43 = (*x_2);
    let _e44 = (*x_2);
    return (_e43 - (floor((_e44 * 0.0034602077f)) * 289f));
}

fn snoise(v: ptr<function, vec2<f32>>) -> f32 {
    var i: vec2<f32>;
    var x0_: vec2<f32>;
    var i1_: vec2<f32>;
    var x12_: vec4<f32>;
    var param_1: vec2<f32>;
    var p: vec3<f32>;
    var param_2: vec3<f32>;
    var param_3: vec3<f32>;
    var m: vec3<f32>;
    var x_3: vec3<f32>;
    var h: vec3<f32>;
    var ox: vec3<f32>;
    var a0_: vec3<f32>;
    var g: vec3<f32>;

    let _e57 = (*v);
    let _e58 = (*v);
    i = floor((_e57 + vec2(dot(_e58, vec2<f32>(0.36602542f, 0.36602542f)))));
    let _e63 = (*v);
    let _e64 = i;
    let _e66 = i;
    x0_ = ((_e63 - _e64) + vec2(dot(_e66, vec2<f32>(0.21132487f, 0.21132487f))));
    let _e71 = x0_[0u];
    let _e73 = x0_[1u];
    i1_ = select(vec2<f32>(0f, 1f), vec2<f32>(1f, 0f), vec2((_e71 > _e73)));
    let _e77 = x0_;
    x12_ = (_e77.xyxy + vec4<f32>(0.21132487f, 0.21132487f, -0.57735026f, -0.57735026f));
    let _e80 = i1_;
    let _e81 = x12_;
    let _e83 = (_e81.xy - _e80);
    x12_[0u] = _e83.x;
    x12_[1u] = _e83.y;
    let _e88 = i;
    param_1 = _e88;
    let _e89 = mod289_u0028_vf2_u003b((&param_1));
    i = _e89;
    let _e91 = i[1u];
    let _e93 = i1_[1u];
    param_2 = (vec3(_e91) + vec3<f32>(0f, _e93, 1f));
    let _e97 = permute((&param_2));
    let _e99 = i[0u];
    let _e103 = i1_[0u];
    param_3 = ((_e97 + vec3(_e99)) + vec3<f32>(0f, _e103, 1f));
    let _e106 = permute((&param_3));
    p = _e106;
    let _e107 = x0_;
    let _e108 = x0_;
    let _e110 = x12_;
    let _e112 = x12_;
    let _e115 = x12_;
    let _e117 = x12_;
    m = max((vec3(0.5f) - vec3<f32>(dot(_e107, _e108), dot(_e110.xy, _e112.xy), dot(_e115.zw, _e117.zw))), vec3(0f));
    let _e125 = m;
    let _e126 = m;
    m = (_e125 * _e126);
    let _e128 = m;
    let _e129 = m;
    m = (_e128 * _e129);
    let _e131 = p;
    x_3 = ((fract((_e131 * vec3<f32>(0.024390243f, 0.024390243f, 0.024390243f))) * 2f) - vec3(1f));
    let _e137 = x_3;
    h = (abs(_e137) - vec3(0.5f));
    let _e141 = x_3;
    ox = floor((_e141 + vec3(0.5f)));
    let _e145 = x_3;
    let _e146 = ox;
    a0_ = (_e145 - _e146);
    let _e148 = a0_;
    let _e149 = a0_;
    let _e151 = h;
    let _e152 = h;
    let _e158 = m;
    m = (_e158 * (vec3(1.7928429f) - (((_e148 * _e149) + (_e151 * _e152)) * 0.85373473f)));
    let _e161 = a0_[0u];
    let _e163 = x0_[0u];
    let _e166 = h[0u];
    let _e168 = x0_[1u];
    g[0u] = ((_e161 * _e163) + (_e166 * _e168));
    let _e172 = a0_;
    let _e174 = x12_;
    let _e177 = h;
    let _e179 = x12_;
    let _e182 = ((_e172.yz * _e174.xz) + (_e177.yz * _e179.yw));
    g[1u] = _e182.x;
    g[2u] = _e182.y;
    let _e187 = m;
    let _e188 = g;
    return (130f * dot(_e187, _e188));
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e44 = (*uv)[0u];
    let _e46 = (*uv)[1u];
    let _e49 = textureSampleLevel(_to, _sampler, vec2<f32>(_e44, (1f - _e46)), 0f);
    return _e49;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e44 = (*uv_1)[0u];
    let _e46 = (*uv_1)[1u];
    let _e49 = textureSampleLevel(_from, _sampler, vec2<f32>(_e44, (1f - _e46)), 0f);
    return _e49;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var center: vec2<f32>;
    var p_1: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var x_4: f32;
    var dist: f32;
    var param_6: vec2<f32>;
    var r: f32;
    var param_7: vec2<f32>;
    var m_1: f32;
    var param_8: vec2<f32>;
    var param_9: vec4<f32>;
    var local: f32;
    var param_10: vec2<f32>;
    var param_11: vec4<f32>;
    var local_1: f32;
    var param_12: vec2<f32>;
    var param_13: vec2<f32>;
    var phi_392_: bool;
    var phi_420_: bool;

    let _e62 = uniforms.direction;
    center = vec2<f32>(1f, select(0f, 1f, (_e62 != 0i)));
    let _e66 = (*uv_2);
    p_1 = (_e66 / vec2<f32>(1f, 1f));
    let _e69 = uniforms.progress;
    if (_e69 == 0f) {
        let _e71 = p_1;
        param_4 = _e71;
        let _e72 = getFromColor((&param_4));
        return _e72;
    } else {
        let _e74 = uniforms.progress;
        if (_e74 == 1f) {
            let _e76 = p_1;
            param_5 = _e76;
            let _e77 = getToColor((&param_5));
            return _e77;
        } else {
            let _e79 = uniforms.progress;
            x_4 = _e79;
            let _e80 = center;
            let _e81 = p_1;
            let _e84 = uniforms.progress;
            let _e86 = p_1[0u];
            param_6 = vec2<f32>(_e86, 0f);
            let _e88 = snoise((&param_6));
            dist = (distance(_e80, _e81) - (_e84 * exp(_e88)));
            let _e92 = x_4;
            let _e94 = p_1[0u];
            param_7 = vec2<f32>(_e94, 0.1f);
            let _e96 = rand((&param_7));
            r = (_e92 - _e96);
            let _e99 = uniforms.above;
            if (_e99 != 0i) {
                let _e101 = dist;
                let _e102 = r;
                let _e103 = (_e101 <= _e102);
                phi_392_ = _e103;
                if _e103 {
                    let _e104 = p_1;
                    param_8 = _e104;
                    let _e105 = getFromColor((&param_8));
                    param_9 = _e105;
                    let _e106 = luminance((&param_9));
                    let _e108 = uniforms.l_threshold;
                    phi_392_ = (_e106 > _e108);
                }
                let _e111 = phi_392_;
                if _e111 {
                    local = 1f;
                } else {
                    let _e113 = uniforms.progress;
                    let _e115 = uniforms.progress;
                    let _e118 = uniforms.progress;
                    local = ((_e113 * _e115) * _e118);
                }
                let _e120 = local;
                m_1 = _e120;
            } else {
                let _e121 = dist;
                let _e122 = r;
                let _e123 = (_e121 <= _e122);
                phi_420_ = _e123;
                if _e123 {
                    let _e124 = p_1;
                    param_10 = _e124;
                    let _e125 = getFromColor((&param_10));
                    param_11 = _e125;
                    let _e126 = luminance((&param_11));
                    let _e128 = uniforms.l_threshold;
                    phi_420_ = (_e126 < _e128);
                }
                let _e131 = phi_420_;
                if _e131 {
                    local_1 = 1f;
                } else {
                    let _e133 = uniforms.progress;
                    let _e135 = uniforms.progress;
                    let _e138 = uniforms.progress;
                    local_1 = ((_e133 * _e135) * _e138);
                }
                let _e140 = local_1;
                m_1 = _e140;
            }
            let _e141 = p_1;
            param_12 = _e141;
            let _e142 = getFromColor((&param_12));
            let _e143 = p_1;
            param_13 = _e143;
            let _e144 = getToColor((&param_13));
            let _e145 = m_1;
            return mix(_e142, _e144, vec4(_e145));
        }
    }
}

fn main_1() {
    var param_14: vec2<f32>;

    let _e43 = _uv_1;
    param_14 = _e43;
    let _e44 = transition((&param_14));
    _fragColor = _e44;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
