// GlitchDisplace — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/GlitchDisplace.glsl
// Author: Matt DesLauriers
// License: MIT
// Description: Blocks of the image are displaced in a glitch that flashes into the incoming image
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

fn ease2(t: ptr<function, f32>) -> f32 {
    var local: f32;

    let _e34 = (*t);
    if (_e34 == 1f) {
        let _e36 = (*t);
        local = _e36;
    } else {
        let _e37 = (*t);
        local = (1f - pow(2f, (-10f * _e37)));
    }
    let _e41 = local;
    return _e41;
}

fn random(co: ptr<function, vec2<f32>>) -> f32 {
    var a: f32;
    var b: f32;
    var c: f32;
    var dt: f32;
    var sn: f32;

    a = 12.9898f;
    b = 78.233f;
    c = 43758.547f;
    let _e38 = (*co);
    let _e39 = a;
    let _e40 = b;
    dt = dot(_e38, vec2<f32>(_e39, _e40));
    let _e43 = dt;
    sn = (_e43 - (floor((_e43 / 3.14f)) * 3.14f));
    let _e48 = sn;
    let _e50 = c;
    return fract((sin(_e48) * _e50));
}

fn voronoi(x: ptr<function, vec2<f32>>) -> f32 {
    var p: vec2<f32>;
    var f: vec2<f32>;
    var res: f32;
    var j: f32;
    var i: f32;
    var b_1: vec2<f32>;
    var r: vec2<f32>;
    var param: vec2<f32>;
    var d: f32;

    let _e42 = (*x);
    p = floor(_e42);
    let _e44 = (*x);
    f = fract(_e44);
    res = 8f;
    j = -1f;
    loop {
        let _e46 = j;
        if (_e46 <= 1f) {
            i = -1f;
            loop {
                let _e48 = i;
                if (_e48 <= 1f) {
                    let _e50 = i;
                    let _e51 = j;
                    b_1 = vec2<f32>(_e50, _e51);
                    let _e53 = b_1;
                    let _e54 = f;
                    let _e56 = p;
                    let _e57 = b_1;
                    param = (_e56 + _e57);
                    let _e59 = random((&param));
                    r = ((_e53 - _e54) + vec2(_e59));
                    let _e62 = r;
                    let _e63 = r;
                    d = dot(_e62, _e63);
                    let _e65 = res;
                    let _e66 = d;
                    res = min(_e65, _e66);
                    continue;
                } else {
                    break;
                }
                continuing {
                    let _e68 = i;
                    i = (_e68 + 1f);
                }
            }
            continue;
        } else {
            break;
        }
        continuing {
            let _e70 = j;
            j = (_e70 + 1f);
        }
    }
    let _e72 = res;
    return sqrt(_e72);
}

fn displace(tex: ptr<function, vec4<f32>>, texCoord: ptr<function, vec2<f32>>, dotDepth: ptr<function, f32>, textureDepth: ptr<function, f32>, strength: ptr<function, f32>) -> vec2<f32> {
    var b_2: f32;
    var param_1: vec2<f32>;
    var g: f32;
    var param_2: vec2<f32>;
    var r_1: f32;
    var param_3: vec2<f32>;
    var dt_1: vec4<f32>;
    var dis: vec4<f32>;
    var res_uv: vec2<f32>;

    let _e46 = (*texCoord);
    param_1 = ((_e46 * 0.003f) + vec2(2f));
    let _e50 = voronoi((&param_1));
    b_2 = _e50;
    let _e51 = (*texCoord);
    param_2 = (_e51 * 0.2f);
    let _e53 = voronoi((&param_2));
    g = _e53;
    let _e54 = (*texCoord);
    param_3 = (_e54 - vec2(1f));
    let _e57 = voronoi((&param_3));
    r_1 = _e57;
    let _e58 = (*tex);
    dt_1 = (_e58 * 1f);
    let _e60 = dt_1;
    let _e61 = (*dotDepth);
    let _e65 = (*tex);
    let _e66 = (*textureDepth);
    dis = (((_e60 * _e61) + vec4(1f)) - (_e65 * _e66));
    let _e70 = dis[0u];
    let _e72 = (*textureDepth);
    let _e73 = (*dotDepth);
    dis[0u] = ((_e70 - 1f) + (_e72 * _e73));
    let _e78 = dis[1u];
    let _e80 = (*textureDepth);
    let _e81 = (*dotDepth);
    dis[1u] = ((_e78 - 1f) + (_e80 * _e81));
    let _e85 = (*strength);
    let _e87 = dis[0u];
    dis[0u] = (_e87 * _e85);
    let _e90 = (*strength);
    let _e92 = dis[1u];
    dis[1u] = (_e92 * _e90);
    let _e95 = (*texCoord);
    res_uv = _e95;
    let _e97 = res_uv[0u];
    let _e99 = dis[0u];
    res_uv[0u] = ((_e97 + _e99) - 0f);
    let _e104 = res_uv[1u];
    let _e106 = dis[1u];
    res_uv[1u] = (_e104 + _e106);
    let _e109 = res_uv;
    return _e109;
}

fn ease1(t_1: ptr<function, f32>) -> f32 {
    var local_1: f32;
    var local_2: f32;

    let _e35 = (*t_1);
    let _e37 = (*t_1);
    if ((_e35 == 0f) || (_e37 == 1f)) {
        let _e40 = (*t_1);
        local_1 = _e40;
    } else {
        let _e41 = (*t_1);
        if (_e41 < 0.5f) {
            let _e43 = (*t_1);
            local_2 = (0.5f * pow(2f, ((20f * _e43) - 10f)));
        } else {
            let _e48 = (*t_1);
            local_2 = ((-0.5f * pow(2f, (10f - (_e48 * 20f)))) + 1f);
        }
        let _e54 = local_2;
        local_1 = _e54;
    }
    let _e55 = local_1;
    return _e55;
}

fn getToColor(uv: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e34 = (*uv)[0u];
    let _e36 = (*uv)[1u];
    let _e39 = textureSampleLevel(_to, _sampler, vec2<f32>(_e34, (1f - _e36)), 0f);
    return _e39;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e34 = (*uv_1)[0u];
    let _e36 = (*uv_1)[1u];
    let _e39 = textureSampleLevel(_from, _sampler, vec2<f32>(_e34, (1f - _e36)), 0f);
    return _e39;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var p_1: vec2<f32>;
    var color1_: vec4<f32>;
    var param_4: vec2<f32>;
    var color2_: vec4<f32>;
    var param_5: vec2<f32>;
    var disp: vec2<f32>;
    var param_6: f32;
    var param_7: vec4<f32>;
    var param_8: vec2<f32>;
    var param_9: f32;
    var param_10: f32;
    var param_11: f32;
    var disp2_: vec2<f32>;
    var param_12: f32;
    var param_13: vec4<f32>;
    var param_14: vec2<f32>;
    var param_15: f32;
    var param_16: f32;
    var param_17: f32;
    var dColor1_: vec4<f32>;
    var param_18: vec2<f32>;
    var dColor2_: vec4<f32>;
    var param_19: vec2<f32>;
    var val: f32;
    var param_20: f32;
    var gray: vec3<f32>;

    let _e59 = (*uv_2);
    p_1 = (_e59 / vec2<f32>(1f, 1f));
    let _e61 = p_1;
    param_4 = _e61;
    let _e62 = getFromColor((&param_4));
    color1_ = _e62;
    let _e63 = p_1;
    param_5 = _e63;
    let _e64 = getToColor((&param_5));
    color2_ = _e64;
    let _e66 = uniforms.progress;
    param_6 = _e66;
    let _e67 = ease1((&param_6));
    let _e69 = color1_;
    param_7 = _e69;
    let _e70 = p_1;
    param_8 = _e70;
    param_9 = 0.33f;
    param_10 = 0.7f;
    param_11 = (1f - _e67);
    let _e71 = displace((&param_7), (&param_8), (&param_9), (&param_10), (&param_11));
    disp = _e71;
    let _e73 = uniforms.progress;
    param_12 = _e73;
    let _e74 = ease2((&param_12));
    let _e75 = color2_;
    param_13 = _e75;
    let _e76 = p_1;
    param_14 = _e76;
    param_15 = 0.33f;
    param_16 = 0.5f;
    param_17 = _e74;
    let _e77 = displace((&param_13), (&param_14), (&param_15), (&param_16), (&param_17));
    disp2_ = _e77;
    let _e78 = disp;
    param_18 = _e78;
    let _e79 = getToColor((&param_18));
    dColor1_ = _e79;
    let _e80 = disp2_;
    param_19 = _e80;
    let _e81 = getFromColor((&param_19));
    dColor2_ = _e81;
    let _e83 = uniforms.progress;
    param_20 = _e83;
    let _e84 = ease1((&param_20));
    val = _e84;
    let _e85 = dColor2_;
    let _e86 = dColor1_;
    gray = vec3(dot(min(_e85, _e86).xyz, vec3<f32>(0.299f, 0.587f, 0.114f)));
    let _e91 = gray;
    dColor2_ = vec4<f32>(_e91.x, _e91.y, _e91.z, 1f);
    let _e96 = dColor2_;
    dColor2_ = (_e96 * 2f);
    let _e98 = color1_;
    let _e99 = dColor2_;
    let _e101 = uniforms.progress;
    color1_ = mix(_e98, _e99, vec4(smoothstep(0f, 0.5f, _e101)));
    let _e105 = color2_;
    let _e106 = dColor1_;
    let _e108 = uniforms.progress;
    color2_ = mix(_e105, _e106, vec4(smoothstep(1f, 0.5f, _e108)));
    let _e112 = color1_;
    let _e113 = color2_;
    let _e114 = val;
    return mix(_e112, _e113, vec4(_e114));
}

fn main_1() {
    var param_21: vec2<f32>;

    let _e33 = _uv_1;
    param_21 = _e33;
    let _e34 = transition((&param_21));
    _fragColor = _e34;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
