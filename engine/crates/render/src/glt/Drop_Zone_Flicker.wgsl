// Drop_Zone_Flicker — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/Drop_Zone_Flicker.glsl
// Author: bread
// License: MIT
// Description: A flickering glitch with RGB offset, ghosting and scanlines that flashes back to the outgoing image
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    frameRate: f32,
    rgbOffset: f32,
    blockAmount: f32,
    ghostAmount: f32,
    redCyan: f32,
    scanline: f32,
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
    let _e106 = (*uv)[0u];
    let _e108 = (*uv)[1u];
    let _e111 = textureSampleLevel(_to, _sampler, vec2<f32>(_e106, (1f - _e108)), 0f);
    return _e111;
}

fn safeUv(uv_1: ptr<function, vec2<f32>>) -> vec2<f32> {
    let _e105 = (*uv_1);
    return clamp(_e105, vec2<f32>(0.001f, 0.001f), vec2<f32>(0.999f, 0.999f));
}

fn chromaTo(uv_2: ptr<function, vec2<f32>>, amt: ptr<function, f32>) -> vec4<f32> {
    var o: vec2<f32>;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;

    let _e113 = (*amt);
    o = vec2<f32>(_e113, 0f);
    let _e115 = (*uv_2);
    let _e116 = o;
    param = (_e115 - _e116);
    let _e118 = safeUv((&param));
    param_1 = _e118;
    let _e119 = getToColor((&param_1));
    let _e121 = (*uv_2);
    param_2 = _e121;
    let _e122 = safeUv((&param_2));
    param_3 = _e122;
    let _e123 = getToColor((&param_3));
    let _e125 = (*uv_2);
    let _e126 = o;
    param_4 = (_e125 + _e126);
    let _e128 = safeUv((&param_4));
    param_5 = _e128;
    let _e129 = getToColor((&param_5));
    return vec4<f32>(_e119.x, _e123.y, _e129.z, 1f);
}

fn getFromColor(uv_3: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e106 = (*uv_3)[0u];
    let _e108 = (*uv_3)[1u];
    let _e111 = textureSampleLevel(_from, _sampler, vec2<f32>(_e106, (1f - _e108)), 0f);
    return _e111;
}

fn chromaFrom(uv_4: ptr<function, vec2<f32>>, amt_1: ptr<function, f32>) -> vec4<f32> {
    var o_1: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;
    var param_11: vec2<f32>;

    let _e113 = (*amt_1);
    o_1 = vec2<f32>(_e113, 0f);
    let _e115 = (*uv_4);
    let _e116 = o_1;
    param_6 = (_e115 + _e116);
    let _e118 = safeUv((&param_6));
    param_7 = _e118;
    let _e119 = getFromColor((&param_7));
    let _e121 = (*uv_4);
    param_8 = _e121;
    let _e122 = safeUv((&param_8));
    param_9 = _e122;
    let _e123 = getFromColor((&param_9));
    let _e125 = (*uv_4);
    let _e126 = o_1;
    param_10 = (_e125 - _e126);
    let _e128 = safeUv((&param_10));
    param_11 = _e128;
    let _e129 = getFromColor((&param_11));
    return vec4<f32>(_e119.x, _e123.y, _e129.z, 1f);
}

fn sat(x: ptr<function, f32>) -> f32 {
    let _e105 = (*x);
    return clamp(_e105, 0f, 1f);
}

fn hash12(p: ptr<function, vec2<f32>>) -> f32 {
    let _e105 = (*p);
    (*p) = fract((_e105 * vec2<f32>(443.8975f, 397.2973f)));
    let _e108 = (*p);
    let _e109 = (*p);
    let _e114 = (*p);
    (*p) = (_e114 + vec2(dot(_e108, (_e109.yx + vec2(19.19f)))));
    let _e118 = (*p)[0u];
    let _e120 = (*p)[1u];
    return fract((_e118 * _e120));
}

fn blockMask(uv_5: ptr<function, vec2<f32>>, f: ptr<function, f32>) -> f32 {
    var big: vec2<f32>;
    var small: vec2<f32>;
    var wide: f32;
    var param_12: vec2<f32>;
    var chunks: f32;
    var param_13: vec2<f32>;
    var verticalCut: f32;
    var param_14: vec2<f32>;
    var param_15: f32;

    let _e115 = (*uv_5);
    big = floor((_e115 * vec2<f32>(4f, 2f)));
    let _e118 = (*uv_5);
    small = floor((_e118 * vec2<f32>(8f, 4f)));
    let _e122 = big[0u];
    let _e123 = (*f);
    param_12 = vec2<f32>(_e122, (_e123 * 1.37f));
    let _e126 = hash12((&param_12));
    wide = step(0.48f, _e126);
    let _e128 = small;
    let _e129 = (*f);
    let _e131 = (*f);
    param_13 = (_e128 + vec2<f32>((_e129 * 2.11f), (_e131 * 0.73f)));
    let _e135 = hash12((&param_13));
    chunks = step(0.56f, _e135);
    let _e138 = (*uv_5)[0u];
    let _e139 = (*f);
    param_14 = vec2<f32>(_e139, 4.7f);
    let _e141 = hash12((&param_14));
    verticalCut = smoothstep(-0.035f, 0.035f, (_e138 - mix(0.18f, 0.78f, _e141)));
    let _e145 = wide;
    let _e146 = chunks;
    let _e149 = verticalCut;
    param_15 = ((mix(_e145, _e146, 0.38f) * 0.72f) + (_e149 * 0.28f));
    let _e152 = sat((&param_15));
    return _e152;
}

fn frameGlitch(f_1: ptr<function, f32>) -> f32 {
    let _e105 = (*f_1);
    if (_e105 < 0.5f) {
        return 0f;
    }
    let _e107 = (*f_1);
    if (_e107 < 6.5f) {
        return 0.92f;
    }
    let _e109 = (*f_1);
    if (_e109 < 10.5f) {
        return 0.38f;
    }
    let _e111 = (*f_1);
    if (_e111 < 11.5f) {
        return 0.78f;
    }
    let _e113 = (*f_1);
    if (_e113 < 12.5f) {
        return 0.12f;
    }
    let _e115 = (*f_1);
    if (_e115 < 17.5f) {
        return 0.74f;
    }
    let _e117 = (*f_1);
    if (_e117 < 22.5f) {
        return 0.88f;
    }
    let _e119 = (*f_1);
    if (_e119 < 23.5f) {
        return 0.28f;
    }
    return 0f;
}

fn frameReveal(f_2: ptr<function, f32>) -> f32 {
    let _e105 = (*f_2);
    if (_e105 < 0.5f) {
        return 0f;
    }
    let _e107 = (*f_2);
    if (_e107 < 1.5f) {
        return 0.28f;
    }
    let _e109 = (*f_2);
    if (_e109 < 2.5f) {
        return 0.43f;
    }
    let _e111 = (*f_2);
    if (_e111 < 3.5f) {
        return 0.46f;
    }
    let _e113 = (*f_2);
    if (_e113 < 4.5f) {
        return 0.38f;
    }
    let _e115 = (*f_2);
    if (_e115 < 5.5f) {
        return 0.48f;
    }
    let _e117 = (*f_2);
    if (_e117 < 6.5f) {
        return 0.26f;
    }
    let _e119 = (*f_2);
    if (_e119 < 7.5f) {
        return 0.1f;
    }
    let _e121 = (*f_2);
    if (_e121 < 8.5f) {
        return 0f;
    }
    let _e123 = (*f_2);
    if (_e123 < 9.5f) {
        return 0f;
    }
    let _e125 = (*f_2);
    if (_e125 < 10.5f) {
        return 0.3f;
    }
    let _e127 = (*f_2);
    if (_e127 < 11.5f) {
        return 0.58f;
    }
    let _e129 = (*f_2);
    if (_e129 < 12.5f) {
        return 1f;
    }
    let _e131 = (*f_2);
    if (_e131 < 13.5f) {
        return 0.7f;
    }
    let _e133 = (*f_2);
    if (_e133 < 14.5f) {
        return 0.42f;
    }
    let _e135 = (*f_2);
    if (_e135 < 15.5f) {
        return 0.55f;
    }
    let _e137 = (*f_2);
    if (_e137 < 16.5f) {
        return 0.72f;
    }
    let _e139 = (*f_2);
    if (_e139 < 17.5f) {
        return 0.88f;
    }
    let _e141 = (*f_2);
    if (_e141 < 18.5f) {
        return 0.34f;
    }
    let _e143 = (*f_2);
    if (_e143 < 19.5f) {
        return 0.48f;
    }
    let _e145 = (*f_2);
    if (_e145 < 20.5f) {
        return 0.56f;
    }
    let _e147 = (*f_2);
    if (_e147 < 21.5f) {
        return 0.76f;
    }
    let _e149 = (*f_2);
    if (_e149 < 22.5f) {
        return 0.93f;
    }
    return 1f;
}

fn transition(uv_6: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_16: vec2<f32>;
    var param_17: vec2<f32>;
    var f_3: f32;
    var reveal: f32;
    var param_18: f32;
    var glitch: f32;
    var param_19: f32;
    var rnd: f32;
    var param_20: vec2<f32>;
    var jitter: vec2<f32>;
    var param_21: vec2<f32>;
    var fromUv: vec2<f32>;
    var param_22: vec2<f32>;
    var toUv: vec2<f32>;
    var param_23: vec2<f32>;
    var block: f32;
    var param_24: vec2<f32>;
    var param_25: f32;
    var localReveal: f32;
    var param_26: vec2<f32>;
    var param_27: f32;
    var oldClip: vec4<f32>;
    var param_28: vec2<f32>;
    var param_29: f32;
    var newClip: vec4<f32>;
    var param_30: vec2<f32>;
    var param_31: f32;
    var color: vec4<f32>;
    var leftWash: f32;
    var cyanWash: f32;
    var redGhost: vec3<f32>;
    var cyanGhost: vec3<f32>;
    var oldReturn: f32;
    var lines: f32;
    var exposurePulse: f32;
    var param_32: vec2<f32>;
    var param_33: f32;
    var param_34: f32;
    var param_35: f32;

    let _e145 = uniforms.progress;
    if (_e145 <= 0f) {
        let _e147 = (*uv_6);
        param_16 = _e147;
        let _e148 = getFromColor((&param_16));
        return _e148;
    }
    let _e150 = uniforms.progress;
    if (_e150 >= 1f) {
        let _e152 = (*uv_6);
        param_17 = _e152;
        let _e153 = getToColor((&param_17));
        return _e153;
    }
    let _e155 = uniforms.progress;
    let _e157 = uniforms.frameRate;
    f_3 = floor((_e155 * _e157));
    let _e160 = f_3;
    param_18 = _e160;
    let _e161 = frameReveal((&param_18));
    reveal = _e161;
    let _e162 = f_3;
    param_19 = _e162;
    let _e163 = frameGlitch((&param_19));
    glitch = _e163;
    let _e164 = f_3;
    param_20 = vec2<f32>(_e164, 9.13f);
    let _e166 = hash12((&param_20));
    rnd = _e166;
    let _e167 = rnd;
    let _e170 = f_3;
    param_21 = vec2<f32>(_e170, 2.71f);
    let _e172 = hash12((&param_21));
    let _e176 = glitch;
    jitter = (vec2<f32>(((_e167 - 0.5f) * 0.042f), ((_e172 - 0.5f) * 0.01f)) * _e176);
    let _e178 = (*uv_6);
    let _e179 = jitter;
    param_22 = (_e178 + _e179);
    let _e181 = safeUv((&param_22));
    fromUv = _e181;
    let _e182 = (*uv_6);
    let _e183 = jitter;
    param_23 = (_e182 - (_e183 * 0.55f));
    let _e186 = safeUv((&param_23));
    toUv = _e186;
    let _e187 = (*uv_6);
    param_24 = _e187;
    let _e188 = f_3;
    param_25 = _e188;
    let _e189 = blockMask((&param_24), (&param_25));
    block = _e189;
    let _e190 = reveal;
    let _e191 = block;
    let _e194 = uniforms.blockAmount;
    let _e196 = glitch;
    let _e199 = f_3;
    let _e201 = (*uv_6)[1u];
    param_26 = vec2<f32>(_e199, floor((_e201 * 9f)));
    let _e205 = hash12((&param_26));
    let _e208 = glitch;
    param_27 = ((_e190 + (((_e191 - 0.5f) * _e194) * _e196)) + (((_e205 - 0.5f) * 0.18f) * _e208));
    let _e211 = sat((&param_27));
    localReveal = _e211;
    let _e212 = localReveal;
    localReveal = smoothstep(0.22f, 0.78f, _e212);
    let _e215 = uniforms.rgbOffset;
    let _e216 = glitch;
    let _e218 = fromUv;
    param_28 = _e218;
    param_29 = (_e215 * _e216);
    let _e219 = chromaFrom((&param_28), (&param_29));
    oldClip = _e219;
    let _e221 = uniforms.rgbOffset;
    let _e222 = glitch;
    let _e224 = toUv;
    param_30 = _e224;
    param_31 = (_e221 * _e222);
    let _e225 = chromaTo((&param_30), (&param_31));
    newClip = _e225;
    let _e226 = oldClip;
    let _e227 = newClip;
    let _e228 = localReveal;
    color = mix(_e226, _e227, vec4(_e228));
    let _e232 = (*uv_6)[0u];
    let _e235 = glitch;
    leftWash = ((1f - smoothstep(0.1f, 0.78f, _e232)) * _e235);
    let _e238 = (*uv_6)[0u];
    let _e241 = (*uv_6)[0u];
    let _e245 = glitch;
    cyanWash = ((smoothstep(0.08f, 0.62f, _e238) * (1f - smoothstep(0.86f, 1f, _e241))) * _e245);
    let _e247 = oldClip;
    redGhost = (_e247.xyz * vec3<f32>(1.34f, 0.42f, 0.38f));
    let _e250 = newClip;
    cyanGhost = (_e250.xyz * vec3<f32>(0.48f, 1.12f, 1.24f));
    let _e253 = color;
    let _e255 = redGhost;
    let _e256 = leftWash;
    let _e258 = uniforms.redCyan;
    let _e262 = mix(_e253.xyz, _e255, vec3(((_e256 * _e258) * 0.42f)));
    color[0u] = _e262.x;
    color[1u] = _e262.y;
    color[2u] = _e262.z;
    let _e269 = color;
    let _e271 = cyanGhost;
    let _e272 = cyanWash;
    let _e274 = uniforms.redCyan;
    let _e278 = mix(_e269.xyz, _e271, vec3(((_e272 * _e274) * 0.3f)));
    color[0u] = _e278.x;
    color[1u] = _e278.y;
    color[2u] = _e278.z;
    let _e285 = glitch;
    let _e286 = reveal;
    oldReturn = (_e285 * (1f - smoothstep(0.94f, 1f, _e286)));
    let _e290 = localReveal;
    let _e297 = oldReturn;
    oldReturn = (_e297 * (0.18f + (0.52f * (1f - (abs((_e290 - 0.5f)) * 2f)))));
    let _e299 = color;
    let _e301 = oldClip;
    let _e303 = oldReturn;
    let _e305 = uniforms.ghostAmount;
    let _e308 = mix(_e299.xyz, _e301.xyz, vec3((_e303 * _e305)));
    color[0u] = _e308.x;
    color[1u] = _e308.y;
    color[2u] = _e308.z;
    let _e316 = (*uv_6)[1u];
    let _e317 = f_3;
    lines = sin(((_e316 + (_e317 * 0.017f)) * 1080f));
    let _e322 = lines;
    let _e324 = uniforms.scanline;
    let _e326 = glitch;
    let _e328 = color;
    let _e331 = (_e328.xyz + vec3(((_e322 * _e324) * _e326)));
    color[0u] = _e331.x;
    color[1u] = _e331.y;
    color[2u] = _e331.z;
    let _e338 = f_3;
    param_32 = vec2<f32>(_e338, 12.4f);
    let _e340 = hash12((&param_32));
    let _e343 = glitch;
    exposurePulse = (((_e340 - 0.35f) * 0.1f) * _e343);
    let _e345 = exposurePulse;
    let _e346 = color;
    let _e349 = (_e346.xyz + vec3(_e345));
    color[0u] = _e349.x;
    color[1u] = _e349.y;
    color[2u] = _e349.z;
    let _e357 = color[0u];
    param_33 = _e357;
    let _e358 = sat((&param_33));
    let _e360 = color[1u];
    param_34 = _e360;
    let _e361 = sat((&param_34));
    let _e363 = color[2u];
    param_35 = _e363;
    let _e364 = sat((&param_35));
    return vec4<f32>(_e358, _e361, _e364, 1f);
}

fn main_1() {
    var param_36: vec2<f32>;

    let _e105 = _uv_1;
    param_36 = _e105;
    let _e106 = transition((&param_36));
    _fragColor = _e106;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
