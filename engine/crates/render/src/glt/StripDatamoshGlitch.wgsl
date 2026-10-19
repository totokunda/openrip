// StripDatamoshGlitch — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/StripDatamoshGlitch.glsl
// Author: bread
// License: MIT
// Description: A datamosh glitch: torn strips, chroma shifts and scan noise drag the outgoing image into the incoming one
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    strength: f32,
    horizontalBars: f32,
    verticalSlits: f32,
    tear: f32,
    chroma: f32,
    residue: f32,
    noiseAmount: f32,
    scanAmount: f32,
    flashAmount: f32,
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

fn hash_u0028_vf2_u003b(p: ptr<function, vec2<f32>>) -> f32 {
    let _e107 = (*p);
    return fract((sin(dot(_e107, vec2<f32>(127.1f, 311.7f))) * 43758.547f));
}

fn stripeY(uv: ptr<function, vec2<f32>>, density: ptr<function, f32>, seed: ptr<function, f32>, minWidth: ptr<function, f32>, maxWidth: ptr<function, f32>) -> f32 {
    var y: f32;
    var id: f32;
    var f: f32;
    var c: f32;
    var param: vec2<f32>;
    var w: f32;
    var param_1: vec2<f32>;

    let _e119 = (*uv)[1u];
    let _e120 = (*density);
    let _e122 = (*seed);
    y = ((_e119 * _e120) + (_e122 * 0.137f));
    let _e125 = y;
    id = floor(_e125);
    let _e127 = y;
    f = fract(_e127);
    let _e129 = id;
    let _e130 = (*seed);
    param = vec2<f32>(_e129, _e130);
    let _e132 = hash_u0028_vf2_u003b((&param));
    c = _e132;
    let _e133 = (*minWidth);
    let _e134 = (*maxWidth);
    let _e135 = id;
    let _e137 = (*seed);
    param_1 = vec2<f32>((_e135 + 9.17f), (_e137 + 2.31f));
    let _e140 = hash_u0028_vf2_u003b((&param_1));
    w = mix(_e133, _e134, _e140);
    let _e142 = w;
    let _e143 = w;
    let _e145 = f;
    let _e146 = c;
    return (1f - smoothstep(_e142, (_e143 + 0.018f), abs((_e145 - _e146))));
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e108 = (*uv_1)[0u];
    let _e110 = (*uv_1)[1u];
    let _e113 = textureSampleLevel(_to, _sampler, vec2<f32>(_e108, (1f - _e110)), 0f);
    return _e113;
}

fn safeUv(uv_2: ptr<function, vec2<f32>>) -> vec2<f32> {
    let _e107 = (*uv_2);
    return clamp(_e107, vec2<f32>(0f, 0f), vec2<f32>(1f, 1f));
}

fn chromaTo(uv_3: ptr<function, vec2<f32>>, s: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;

    let _e114 = (*uv_3);
    param_2 = _e114;
    let _e115 = safeUv((&param_2));
    (*uv_3) = _e115;
    let _e116 = (*uv_3);
    let _e117 = (*s);
    param_3 = (_e116 - _e117);
    let _e119 = safeUv((&param_3));
    param_4 = _e119;
    let _e120 = getToColor((&param_4));
    let _e122 = (*uv_3);
    param_5 = _e122;
    let _e123 = getToColor((&param_5));
    let _e125 = (*uv_3);
    let _e126 = (*s);
    param_6 = (_e125 + _e126);
    let _e128 = safeUv((&param_6));
    param_7 = _e128;
    let _e129 = getToColor((&param_7));
    return vec4<f32>(_e120.x, _e123.y, _e129.z, 1f);
}

fn getFromColor(uv_4: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e108 = (*uv_4)[0u];
    let _e110 = (*uv_4)[1u];
    let _e113 = textureSampleLevel(_from, _sampler, vec2<f32>(_e108, (1f - _e110)), 0f);
    return _e113;
}

fn chromaFrom(uv_5: ptr<function, vec2<f32>>, s_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_8: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;
    var param_11: vec2<f32>;
    var param_12: vec2<f32>;
    var param_13: vec2<f32>;

    let _e114 = (*uv_5);
    param_8 = _e114;
    let _e115 = safeUv((&param_8));
    (*uv_5) = _e115;
    let _e116 = (*uv_5);
    let _e117 = (*s_1);
    param_9 = (_e116 + _e117);
    let _e119 = safeUv((&param_9));
    param_10 = _e119;
    let _e120 = getFromColor((&param_10));
    let _e122 = (*uv_5);
    param_11 = _e122;
    let _e123 = getFromColor((&param_11));
    let _e125 = (*uv_5);
    let _e126 = (*s_1);
    param_12 = (_e125 - _e126);
    let _e128 = safeUv((&param_12));
    param_13 = _e128;
    let _e129 = getFromColor((&param_13));
    return vec4<f32>(_e120.x, _e123.y, _e129.z, 1f);
}

fn distortUv(uv_6: ptr<function, vec2<f32>>, dir: ptr<function, f32>, b: ptr<function, f32>, h: ptr<function, f32>, v: ptr<function, f32>, frame: ptr<function, f32>) -> vec2<f32> {
    var row: f32;
    var col: f32;
    var rowRnd: f32;
    var param_14: vec2<f32>;
    var colRnd: f32;
    var param_15: vec2<f32>;
    var xTear: f32;
    var yDrag: f32;
    var micro: f32;
    var param_16: vec2<f32>;

    let _e123 = (*uv_6)[1u];
    let _e125 = uniforms.horizontalBars;
    row = floor((_e123 * _e125));
    let _e129 = (*uv_6)[0u];
    let _e131 = uniforms.verticalSlits;
    col = floor((_e129 * _e131));
    let _e134 = row;
    let _e135 = (*frame);
    param_14 = vec2<f32>(_e134, _e135);
    let _e137 = hash_u0028_vf2_u003b((&param_14));
    rowRnd = _e137;
    let _e138 = col;
    let _e139 = (*frame);
    param_15 = vec2<f32>(_e138, (_e139 + 27f));
    let _e142 = hash_u0028_vf2_u003b((&param_15));
    colRnd = _e142;
    let _e143 = rowRnd;
    let _e147 = uniforms.tear;
    let _e149 = (*b);
    let _e151 = (*h);
    xTear = (((((_e143 - 0.5f) * 2f) * _e147) * _e149) * _e151);
    let _e154 = (*uv_6)[1u];
    let _e157 = uniforms.progress;
    let _e162 = (*b);
    let _e164 = xTear;
    xTear = (_e164 + ((sin(((_e154 * 120f) + (_e157 * 95f))) * 0.006f) * _e162));
    let _e166 = colRnd;
    let _e169 = (*b);
    let _e171 = (*v);
    yDrag = ((((_e166 - 0.5f) * 0.13f) * _e169) * _e171);
    let _e173 = row;
    let _e174 = col;
    let _e175 = (*frame);
    param_16 = vec2<f32>(_e173, (_e174 + _e175));
    let _e178 = hash_u0028_vf2_u003b((&param_16));
    let _e181 = (*b);
    let _e183 = (*h);
    let _e184 = (*v);
    micro = ((((_e178 - 0.5f) * 0.018f) * _e181) * max(_e183, _e184));
    let _e187 = (*uv_6);
    let _e188 = xTear;
    let _e189 = (*dir);
    let _e191 = micro;
    let _e193 = yDrag;
    return (_e187 + vec2<f32>(((_e188 * _e189) + _e191), _e193));
}

fn sat(v_1: ptr<function, f32>) -> f32 {
    let _e107 = (*v_1);
    return clamp(_e107, 0f, 1f);
}

fn stripeX(uv_7: ptr<function, vec2<f32>>, density_1: ptr<function, f32>, seed_1: ptr<function, f32>, minWidth_1: ptr<function, f32>, maxWidth_1: ptr<function, f32>) -> f32 {
    var x: f32;
    var id_1: f32;
    var f_1: f32;
    var c_1: f32;
    var param_17: vec2<f32>;
    var w_1: f32;
    var param_18: vec2<f32>;

    let _e119 = (*uv_7)[0u];
    let _e120 = (*density_1);
    let _e122 = (*seed_1);
    x = ((_e119 * _e120) + (_e122 * 0.091f));
    let _e125 = x;
    id_1 = floor(_e125);
    let _e127 = x;
    f_1 = fract(_e127);
    let _e129 = id_1;
    let _e130 = (*seed_1);
    param_17 = vec2<f32>(_e129, (_e130 + 41f));
    let _e133 = hash_u0028_vf2_u003b((&param_17));
    c_1 = _e133;
    let _e134 = (*minWidth_1);
    let _e135 = (*maxWidth_1);
    let _e136 = id_1;
    let _e138 = (*seed_1);
    param_18 = vec2<f32>((_e136 + 4.7f), (_e138 + 8.9f));
    let _e141 = hash_u0028_vf2_u003b((&param_18));
    w_1 = mix(_e134, _e135, _e141);
    let _e143 = w_1;
    let _e144 = w_1;
    let _e146 = f_1;
    let _e147 = c_1;
    return (1f - smoothstep(_e143, (_e144 + 0.012f), abs((_e146 - _e147))));
}

fn hash_u0028_f1_u003b(n: ptr<function, f32>) -> f32 {
    let _e107 = (*n);
    return fract((sin(_e107) * 43758.547f));
}

fn verticalMask(uv_8: ptr<function, vec2<f32>>, frame_1: ptr<function, f32>) -> f32 {
    var col_1: f32;
    var param_19: f32;
    var slit: f32;
    var param_20: vec2<f32>;
    var param_21: f32;
    var param_22: f32;
    var param_23: f32;
    var param_24: f32;
    var param_25: vec2<f32>;
    var param_26: f32;

    let _e119 = (*uv_8)[0u];
    let _e120 = (*frame_1);
    param_19 = (_e120 + 12f);
    let _e122 = hash_u0028_f1_u003b((&param_19));
    let _e126 = uniforms.verticalSlits;
    col_1 = floor(((_e119 + (_e122 * 0.017f)) * _e126));
    let _e129 = (*frame_1);
    let _e131 = (*uv_8);
    param_20 = _e131;
    let _e133 = uniforms.verticalSlits;
    param_21 = _e133;
    param_22 = (_e129 + 13f);
    param_23 = 0.01f;
    param_24 = 0.075f;
    let _e134 = stripeX((&param_20), (&param_21), (&param_22), (&param_23), (&param_24));
    slit = _e134;
    let _e135 = col_1;
    let _e136 = (*frame_1);
    param_25 = vec2<f32>(_e135, (_e136 + 19f));
    let _e139 = hash_u0028_vf2_u003b((&param_25));
    let _e141 = slit;
    slit = (_e141 * step(0.66f, _e139));
    let _e143 = slit;
    param_26 = _e143;
    let _e144 = sat((&param_26));
    return _e144;
}

fn brokenGate(uv_9: ptr<function, vec2<f32>>, row_1: ptr<function, f32>, rnd: ptr<function, f32>, frame_2: ptr<function, f32>) -> f32 {
    var segs: f32;
    var param_27: vec2<f32>;
    var seg: f32;
    var param_28: vec2<f32>;

    let _e114 = (*row_1);
    let _e115 = (*frame_2);
    param_27 = vec2<f32>(_e114, (_e115 + 44f));
    let _e118 = hash_u0028_vf2_u003b((&param_27));
    segs = mix(1f, 9f, _e118);
    let _e121 = (*uv_9)[0u];
    let _e122 = segs;
    seg = floor((_e121 * _e122));
    let _e125 = seg;
    let _e126 = (*row_1);
    let _e127 = (*frame_2);
    let _e130 = (*rnd);
    param_28 = vec2<f32>(_e125, ((_e126 + (_e127 * 3f)) + _e130));
    let _e133 = hash_u0028_vf2_u003b((&param_28));
    return step(0.16f, _e133);
}

fn horizontalMask(uv_10: ptr<function, vec2<f32>>, frame_3: ptr<function, f32>) -> f32 {
    var r1_: f32;
    var param_29: f32;
    var r2_: f32;
    var param_30: f32;
    var r3_: f32;
    var param_31: f32;
    var thick: f32;
    var param_32: vec2<f32>;
    var param_33: f32;
    var param_34: f32;
    var param_35: f32;
    var param_36: f32;
    var mid: f32;
    var param_37: vec2<f32>;
    var param_38: f32;
    var param_39: f32;
    var param_40: f32;
    var param_41: f32;
    var hair: f32;
    var param_42: vec2<f32>;
    var param_43: f32;
    var param_44: f32;
    var param_45: f32;
    var param_46: f32;
    var param_47: vec2<f32>;
    var param_48: vec2<f32>;
    var param_49: vec2<f32>;
    var param_50: vec2<f32>;
    var param_51: vec2<f32>;
    var param_52: f32;
    var param_53: f32;
    var param_54: f32;
    var param_55: vec2<f32>;
    var param_56: vec2<f32>;
    var param_57: f32;
    var param_58: f32;
    var param_59: f32;
    var param_60: f32;

    let _e147 = (*uv_10)[1u];
    let _e148 = (*frame_3);
    param_29 = _e148;
    let _e149 = hash_u0028_f1_u003b((&param_29));
    let _e153 = uniforms.horizontalBars;
    r1_ = floor((((_e147 + (_e149 * 0.031f)) * _e153) * 0.38f));
    let _e158 = (*uv_10)[1u];
    let _e159 = (*frame_3);
    param_30 = (_e159 + 2f);
    let _e161 = hash_u0028_f1_u003b((&param_30));
    let _e165 = uniforms.horizontalBars;
    r2_ = floor(((_e158 + (_e161 * 0.013f)) * _e165));
    let _e169 = (*uv_10)[1u];
    let _e170 = (*frame_3);
    param_31 = (_e170 + 7f);
    let _e172 = hash_u0028_f1_u003b((&param_31));
    let _e176 = uniforms.horizontalBars;
    r3_ = floor((((_e169 + (_e172 * 0.006f)) * _e176) * 3.4f));
    let _e181 = uniforms.horizontalBars;
    let _e183 = (*frame_3);
    let _e185 = (*uv_10);
    param_32 = _e185;
    param_33 = (_e181 * 0.38f);
    param_34 = (_e183 + 1f);
    param_35 = 0.035f;
    param_36 = 0.22f;
    let _e186 = stripeY((&param_32), (&param_33), (&param_34), (&param_35), (&param_36));
    thick = _e186;
    let _e187 = (*frame_3);
    let _e189 = (*uv_10);
    param_37 = _e189;
    let _e191 = uniforms.horizontalBars;
    param_38 = _e191;
    param_39 = (_e187 + 4f);
    param_40 = 0.014f;
    param_41 = 0.11f;
    let _e192 = stripeY((&param_37), (&param_38), (&param_39), (&param_40), (&param_41));
    mid = _e192;
    let _e194 = uniforms.horizontalBars;
    let _e196 = (*frame_3);
    let _e198 = (*uv_10);
    param_42 = _e198;
    param_43 = (_e194 * 3.4f);
    param_44 = (_e196 + 9f);
    param_45 = 0.004f;
    param_46 = 0.035f;
    let _e199 = stripeY((&param_42), (&param_43), (&param_44), (&param_45), (&param_46));
    hair = _e199;
    let _e200 = r1_;
    let _e201 = (*frame_3);
    param_47 = vec2<f32>(_e200, (_e201 + 10f));
    let _e204 = hash_u0028_vf2_u003b((&param_47));
    let _e206 = thick;
    thick = (_e206 * step(0.42f, _e204));
    let _e208 = r2_;
    let _e209 = (*frame_3);
    param_48 = vec2<f32>(_e208, (_e209 + 20f));
    let _e212 = hash_u0028_vf2_u003b((&param_48));
    let _e214 = mid;
    mid = (_e214 * step(0.48f, _e212));
    let _e216 = r3_;
    let _e217 = (*frame_3);
    param_49 = vec2<f32>(_e216, (_e217 + 30f));
    let _e220 = hash_u0028_vf2_u003b((&param_49));
    let _e222 = hair;
    hair = (_e222 * step(0.62f, _e220));
    let _e224 = r1_;
    let _e225 = (*frame_3);
    param_50 = vec2<f32>(_e224, _e225);
    let _e227 = hash_u0028_vf2_u003b((&param_50));
    let _e228 = (*uv_10);
    param_51 = _e228;
    let _e229 = r1_;
    param_52 = _e229;
    param_53 = _e227;
    let _e230 = (*frame_3);
    param_54 = _e230;
    let _e231 = brokenGate((&param_51), (&param_52), (&param_53), (&param_54));
    let _e232 = thick;
    thick = (_e232 * _e231);
    let _e234 = r2_;
    let _e235 = (*frame_3);
    param_55 = vec2<f32>(_e234, _e235);
    let _e237 = hash_u0028_vf2_u003b((&param_55));
    let _e238 = (*frame_3);
    let _e240 = (*uv_10);
    param_56 = _e240;
    let _e241 = r2_;
    param_57 = _e241;
    param_58 = _e237;
    param_59 = (_e238 + 3f);
    let _e242 = brokenGate((&param_56), (&param_57), (&param_58), (&param_59));
    let _e243 = mid;
    mid = (_e243 * _e242);
    let _e245 = thick;
    let _e246 = mid;
    let _e247 = hair;
    param_60 = max(_e245, max(_e246, _e247));
    let _e250 = sat((&param_60));
    return _e250;
}

fn burst_u0028_() -> f32 {
    let _e107 = uniforms.progress;
    let _e113 = uniforms.strength;
    return (pow(max(0f, sin((_e107 * 3.1415927f))), 0.42f) * _e113);
}

fn transition(uv_11: ptr<function, vec2<f32>>) -> vec4<f32> {
    var param_61: vec2<f32>;
    var param_62: vec2<f32>;
    var b_1: f32;
    var frame_4: f32;
    var h_1: f32;
    var param_63: vec2<f32>;
    var param_64: f32;
    var v_2: f32;
    var param_65: vec2<f32>;
    var param_66: f32;
    var glitch: f32;
    var param_67: f32;
    var row_2: f32;
    var rowRnd_1: f32;
    var param_68: vec2<f32>;
    var bandDelay: f32;
    var reveal: f32;
    var split: vec2<f32>;
    var fromUv: vec2<f32>;
    var param_69: vec2<f32>;
    var param_70: f32;
    var param_71: f32;
    var param_72: f32;
    var param_73: f32;
    var param_74: f32;
    var toUv: vec2<f32>;
    var param_75: vec2<f32>;
    var param_76: f32;
    var param_77: f32;
    var param_78: f32;
    var param_79: f32;
    var param_80: f32;
    var color: vec4<f32>;
    var param_81: vec2<f32>;
    var param_82: vec2<f32>;
    var param_83: vec2<f32>;
    var param_84: vec2<f32>;
    var smearUv: vec2<f32>;
    var param_85: vec2<f32>;
    var sliceReveal: f32;
    var sliceColor: vec4<f32>;
    var param_86: vec2<f32>;
    var param_87: vec2<f32>;
    var param_88: vec2<f32>;
    var param_89: vec2<f32>;
    var hairLine: f32;
    var param_90: vec2<f32>;
    var param_91: f32;
    var param_92: f32;
    var param_93: f32;
    var param_94: f32;
    var param_95: vec2<f32>;
    var scan: f32;
    var nCell: vec2<f32>;
    var n_1: f32;
    var param_96: vec2<f32>;
    var luma: f32;
    var strobe: f32;
    var param_97: vec2<f32>;

    let _e167 = uniforms.progress;
    if (_e167 <= 0f) {
        let _e169 = (*uv_11);
        param_61 = _e169;
        let _e170 = getFromColor((&param_61));
        return _e170;
    }
    let _e172 = uniforms.progress;
    if (_e172 >= 1f) {
        let _e174 = (*uv_11);
        param_62 = _e174;
        let _e175 = getToColor((&param_62));
        return _e175;
    }
    let _e176 = burst_u0028_();
    b_1 = _e176;
    let _e178 = uniforms.progress;
    frame_4 = floor((_e178 * 30f));
    let _e181 = (*uv_11);
    param_63 = _e181;
    let _e182 = frame_4;
    param_64 = _e182;
    let _e183 = horizontalMask((&param_63), (&param_64));
    h_1 = _e183;
    let _e184 = (*uv_11);
    param_65 = _e184;
    let _e185 = frame_4;
    param_66 = _e185;
    let _e186 = verticalMask((&param_65), (&param_66));
    v_2 = _e186;
    let _e187 = h_1;
    let _e188 = v_2;
    param_67 = max(_e187, (_e188 * 0.75f));
    let _e191 = sat((&param_67));
    glitch = _e191;
    let _e193 = (*uv_11)[1u];
    let _e195 = uniforms.horizontalBars;
    row_2 = floor((_e193 * _e195));
    let _e198 = row_2;
    let _e199 = frame_4;
    param_68 = vec2<f32>(_e198, (_e199 + 5f));
    let _e202 = hash_u0028_vf2_u003b((&param_68));
    rowRnd_1 = _e202;
    let _e203 = rowRnd_1;
    let _e206 = h_1;
    bandDelay = (((_e203 - 0.5f) * 0.3f) * _e206);
    let _e209 = uniforms.progress;
    let _e210 = bandDelay;
    reveal = smoothstep(0.18f, 0.84f, (_e209 + _e210));
    let _e214 = uniforms.chroma;
    let _e215 = b_1;
    let _e217 = glitch;
    let _e222 = uniforms.chroma;
    let _e224 = b_1;
    let _e226 = v_2;
    split = vec2<f32>(((_e214 * _e215) * (1f + (1.7f * _e217))), (((_e222 * 0.22f) * _e224) * _e226));
    let _e229 = (*uv_11);
    param_69 = _e229;
    param_70 = 1f;
    let _e230 = b_1;
    param_71 = _e230;
    let _e231 = h_1;
    param_72 = _e231;
    let _e232 = v_2;
    param_73 = _e232;
    let _e233 = frame_4;
    param_74 = _e233;
    let _e234 = distortUv((&param_69), (&param_70), (&param_71), (&param_72), (&param_73), (&param_74));
    fromUv = _e234;
    let _e235 = (*uv_11);
    param_75 = _e235;
    param_76 = -1f;
    let _e236 = b_1;
    param_77 = _e236;
    let _e237 = h_1;
    param_78 = _e237;
    let _e238 = v_2;
    param_79 = _e238;
    let _e239 = frame_4;
    param_80 = _e239;
    let _e240 = distortUv((&param_75), (&param_76), (&param_77), (&param_78), (&param_79), (&param_80));
    toUv = _e240;
    let _e241 = fromUv;
    param_81 = _e241;
    let _e242 = split;
    param_82 = _e242;
    let _e243 = chromaFrom((&param_81), (&param_82));
    let _e244 = toUv;
    param_83 = _e244;
    let _e245 = split;
    param_84 = _e245;
    let _e246 = chromaTo((&param_83), (&param_84));
    let _e247 = reveal;
    color = mix(_e243, _e246, vec4(_e247));
    let _e250 = (*uv_11);
    smearUv = _e250;
    let _e251 = rowRnd_1;
    let _e254 = b_1;
    let _e256 = h_1;
    let _e259 = smearUv[0u];
    smearUv[0u] = (_e259 + ((((_e251 - 0.5f) * 0.46f) * _e254) * _e256));
    let _e262 = row_2;
    let _e263 = frame_4;
    param_85 = vec2<f32>(_e262, (_e263 + 31f));
    let _e266 = hash_u0028_vf2_u003b((&param_85));
    let _e269 = b_1;
    let _e271 = h_1;
    let _e274 = smearUv[1u];
    smearUv[1u] = (_e274 + ((((_e266 - 0.5f) * 0.045f) * _e269) * _e271));
    let _e278 = uniforms.progress;
    let _e279 = rowRnd_1;
    sliceReveal = smoothstep(0.28f, 0.78f, (_e278 + ((_e279 - 0.5f) * 0.22f)));
    let _e284 = split;
    let _e286 = smearUv;
    param_86 = _e286;
    param_87 = (_e284 * 1.65f);
    let _e287 = chromaFrom((&param_86), (&param_87));
    let _e288 = smearUv;
    let _e289 = rowRnd_1;
    let _e292 = b_1;
    let _e296 = split;
    param_88 = (_e288 - vec2<f32>((((_e289 - 0.5f) * 0.18f) * _e292), 0f));
    param_89 = (_e296 * 1.65f);
    let _e298 = chromaTo((&param_88), (&param_89));
    let _e299 = sliceReveal;
    sliceColor = mix(_e287, _e298, vec4(_e299));
    let _e302 = color;
    let _e303 = sliceColor;
    let _e304 = h_1;
    let _e305 = b_1;
    let _e308 = uniforms.residue;
    color = mix(_e302, _e303, vec4(((_e304 * _e305) * _e308)));
    let _e312 = frame_4;
    let _e314 = (*uv_11);
    param_90 = _e314;
    param_91 = 190f;
    param_92 = (_e312 + 55f);
    param_93 = 0.002f;
    param_94 = 0.012f;
    let _e315 = stripeY((&param_90), (&param_91), (&param_92), (&param_93), (&param_94));
    hairLine = _e315;
    let _e317 = (*uv_11)[1u];
    let _e320 = frame_4;
    param_95 = vec2<f32>(floor((_e317 * 190f)), (_e320 + 56f));
    let _e323 = hash_u0028_vf2_u003b((&param_95));
    let _e325 = hairLine;
    hairLine = (_e325 * step(0.7f, _e323));
    let _e327 = hairLine;
    let _e329 = b_1;
    let _e332 = color;
    let _e334 = (_e332.xyz + (((vec3<f32>(0.72f, 0.9f, 1f) * _e327) * _e329) * 0.28f));
    color[0u] = _e334.x;
    color[1u] = _e334.y;
    color[2u] = _e334.z;
    let _e342 = (*uv_11)[1u];
    let _e345 = uniforms.progress;
    scan = (0.5f + (0.5f * sin(((_e342 * 980f) + (_e345 * 130f)))));
    let _e352 = uniforms.scanAmount;
    let _e353 = b_1;
    let _e355 = scan;
    let _e358 = color;
    let _e360 = (_e358.xyz * (1f - ((_e352 * _e353) * _e355)));
    color[0u] = _e360.x;
    color[1u] = _e360.y;
    color[2u] = _e360.z;
    let _e367 = (*uv_11);
    let _e369 = uniforms.ratio;
    nCell = floor((_e367 * vec2<f32>((360f * _e369), 210f)));
    let _e374 = nCell;
    let _e375 = frame_4;
    let _e377 = frame_4;
    param_96 = (_e374 + vec2<f32>((_e375 * 7f), (_e377 * 13f)));
    let _e381 = hash_u0028_vf2_u003b((&param_96));
    n_1 = _e381;
    let _e382 = n_1;
    let _e385 = uniforms.noiseAmount;
    let _e387 = b_1;
    let _e389 = glitch;
    let _e392 = color;
    let _e395 = (_e392.xyz + vec3(((((_e382 - 0.5f) * _e385) * _e387) * (0.55f + _e389))));
    color[0u] = _e395.x;
    color[1u] = _e395.y;
    color[2u] = _e395.z;
    let _e402 = color;
    luma = dot(_e402.xyz, vec3<f32>(0.299f, 0.587f, 0.114f));
    let _e405 = color;
    let _e407 = luma;
    let _e409 = b_1;
    let _e411 = glitch;
    let _e414 = mix(_e405.xyz, vec3(_e407), vec3(((0.18f * _e409) * _e411)));
    color[0u] = _e414.x;
    color[1u] = _e414.y;
    color[2u] = _e414.z;
    let _e421 = frame_4;
    param_97 = vec2<f32>(_e421, 3.14f);
    let _e423 = hash_u0028_vf2_u003b((&param_97));
    let _e425 = b_1;
    strobe = (step(0.78f, _e423) * pow(_e425, 1.65f));
    let _e428 = strobe;
    let _e430 = uniforms.flashAmount;
    let _e433 = color;
    let _e435 = (_e433.xyz + vec3((_e428 * _e430)));
    color[0u] = _e435.x;
    color[1u] = _e435.y;
    color[2u] = _e435.z;
    let _e442 = color;
    let _e444 = clamp(_e442.xyz, vec3<f32>(0f, 0f, 0f), vec3<f32>(1f, 1f, 1f));
    return vec4<f32>(_e444.x, _e444.y, _e444.z, 1f);
}

fn main_1() {
    var param_98: vec2<f32>;

    let _e107 = _uv_1;
    param_98 = _e107;
    let _e108 = transition((&param_98));
    _fragColor = _e108;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
