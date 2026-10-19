// DefocusBlur — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/DefocusBlur.glsl
// Author: Sergey Kosarevsky
// License: MIT
// Description: A crossfade through an out-of-focus blur
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    blurSize: f32,
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
    let _e52 = (*uv)[0u];
    let _e54 = (*uv)[1u];
    let _e57 = textureSampleLevel(_to, _sampler, vec2<f32>(_e52, (1f - _e54)), 0f);
    return _e57;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e52 = (*uv_1)[0u];
    let _e54 = (*uv_1)[1u];
    let _e57 = textureSampleLevel(_from, _sampler, vec2<f32>(_e52, (1f - _e54)), 0f);
    return _e57;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var T: f32;
    var half: f32;
    var D: f32;
    var local: f32;
    var C0_: vec4<f32>;
    var param: vec2<f32>;
    var C1_: vec4<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;
    var param_11: vec2<f32>;
    var param_12: vec2<f32>;
    var param_13: vec2<f32>;
    var param_14: vec2<f32>;
    var param_15: vec2<f32>;
    var param_16: vec2<f32>;
    var param_17: vec2<f32>;
    var param_18: vec2<f32>;
    var param_19: vec2<f32>;
    var param_20: vec2<f32>;
    var param_21: vec2<f32>;
    var param_22: vec2<f32>;
    var param_23: vec2<f32>;
    var param_24: vec2<f32>;
    var param_25: vec2<f32>;

    let _e84 = uniforms.progress;
    T = _e84;
    half = 0.5f;
    let _e85 = T;
    let _e86 = half;
    if (_e85 < _e86) {
        let _e89 = uniforms.blurSize;
        let _e90 = T;
        let _e91 = half;
        local = mix(0f, _e89, (_e90 / _e91));
    } else {
        let _e95 = uniforms.blurSize;
        let _e96 = T;
        let _e97 = half;
        let _e99 = half;
        local = mix(_e95, 0f, ((_e96 - _e97) / _e99));
    }
    let _e102 = local;
    D = _e102;
    let _e103 = (*uv_2);
    param = _e103;
    let _e104 = getFromColor((&param));
    C0_ = _e104;
    let _e105 = (*uv_2);
    param_1 = _e105;
    let _e106 = getToColor((&param_1));
    C1_ = _e106;
    let _e107 = D;
    let _e109 = (*uv_2);
    param_2 = ((vec2<f32>(-0.326f, -0.406f) * _e107) + _e109);
    let _e111 = getFromColor((&param_2));
    let _e112 = C0_;
    C0_ = (_e112 + _e111);
    let _e114 = D;
    let _e116 = (*uv_2);
    param_3 = ((vec2<f32>(-0.326f, -0.406f) * _e114) + _e116);
    let _e118 = getToColor((&param_3));
    let _e119 = C1_;
    C1_ = (_e119 + _e118);
    let _e121 = D;
    let _e123 = (*uv_2);
    param_4 = ((vec2<f32>(-0.84f, -0.074f) * _e121) + _e123);
    let _e125 = getFromColor((&param_4));
    let _e126 = C0_;
    C0_ = (_e126 + _e125);
    let _e128 = D;
    let _e130 = (*uv_2);
    param_5 = ((vec2<f32>(-0.84f, -0.074f) * _e128) + _e130);
    let _e132 = getToColor((&param_5));
    let _e133 = C1_;
    C1_ = (_e133 + _e132);
    let _e135 = D;
    let _e137 = (*uv_2);
    param_6 = ((vec2<f32>(-0.696f, 0.457f) * _e135) + _e137);
    let _e139 = getFromColor((&param_6));
    let _e140 = C0_;
    C0_ = (_e140 + _e139);
    let _e142 = D;
    let _e144 = (*uv_2);
    param_7 = ((vec2<f32>(-0.696f, 0.457f) * _e142) + _e144);
    let _e146 = getToColor((&param_7));
    let _e147 = C1_;
    C1_ = (_e147 + _e146);
    let _e149 = D;
    let _e151 = (*uv_2);
    param_8 = ((vec2<f32>(-0.203f, 0.621f) * _e149) + _e151);
    let _e153 = getFromColor((&param_8));
    let _e154 = C0_;
    C0_ = (_e154 + _e153);
    let _e156 = D;
    let _e158 = (*uv_2);
    param_9 = ((vec2<f32>(-0.203f, 0.621f) * _e156) + _e158);
    let _e160 = getToColor((&param_9));
    let _e161 = C1_;
    C1_ = (_e161 + _e160);
    let _e163 = D;
    let _e165 = (*uv_2);
    param_10 = ((vec2<f32>(0.962f, -0.195f) * _e163) + _e165);
    let _e167 = getFromColor((&param_10));
    let _e168 = C0_;
    C0_ = (_e168 + _e167);
    let _e170 = D;
    let _e172 = (*uv_2);
    param_11 = ((vec2<f32>(0.962f, -0.195f) * _e170) + _e172);
    let _e174 = getToColor((&param_11));
    let _e175 = C1_;
    C1_ = (_e175 + _e174);
    let _e177 = D;
    let _e179 = (*uv_2);
    param_12 = ((vec2<f32>(0.473f, -0.48f) * _e177) + _e179);
    let _e181 = getFromColor((&param_12));
    let _e182 = C0_;
    C0_ = (_e182 + _e181);
    let _e184 = D;
    let _e186 = (*uv_2);
    param_13 = ((vec2<f32>(0.473f, -0.48f) * _e184) + _e186);
    let _e188 = getToColor((&param_13));
    let _e189 = C1_;
    C1_ = (_e189 + _e188);
    let _e191 = D;
    let _e193 = (*uv_2);
    param_14 = ((vec2<f32>(0.519f, 0.767f) * _e191) + _e193);
    let _e195 = getFromColor((&param_14));
    let _e196 = C0_;
    C0_ = (_e196 + _e195);
    let _e198 = D;
    let _e200 = (*uv_2);
    param_15 = ((vec2<f32>(0.519f, 0.767f) * _e198) + _e200);
    let _e202 = getToColor((&param_15));
    let _e203 = C1_;
    C1_ = (_e203 + _e202);
    let _e205 = D;
    let _e207 = (*uv_2);
    param_16 = ((vec2<f32>(0.185f, -0.893f) * _e205) + _e207);
    let _e209 = getFromColor((&param_16));
    let _e210 = C0_;
    C0_ = (_e210 + _e209);
    let _e212 = D;
    let _e214 = (*uv_2);
    param_17 = ((vec2<f32>(0.185f, -0.893f) * _e212) + _e214);
    let _e216 = getToColor((&param_17));
    let _e217 = C1_;
    C1_ = (_e217 + _e216);
    let _e219 = D;
    let _e221 = (*uv_2);
    param_18 = ((vec2<f32>(0.507f, 0.064f) * _e219) + _e221);
    let _e223 = getFromColor((&param_18));
    let _e224 = C0_;
    C0_ = (_e224 + _e223);
    let _e226 = D;
    let _e228 = (*uv_2);
    param_19 = ((vec2<f32>(0.507f, 0.064f) * _e226) + _e228);
    let _e230 = getToColor((&param_19));
    let _e231 = C1_;
    C1_ = (_e231 + _e230);
    let _e233 = D;
    let _e235 = (*uv_2);
    param_20 = ((vec2<f32>(0.896f, 0.412f) * _e233) + _e235);
    let _e237 = getFromColor((&param_20));
    let _e238 = C0_;
    C0_ = (_e238 + _e237);
    let _e240 = D;
    let _e242 = (*uv_2);
    param_21 = ((vec2<f32>(0.896f, 0.412f) * _e240) + _e242);
    let _e244 = getToColor((&param_21));
    let _e245 = C1_;
    C1_ = (_e245 + _e244);
    let _e247 = D;
    let _e249 = (*uv_2);
    param_22 = ((vec2<f32>(-0.322f, -0.933f) * _e247) + _e249);
    let _e251 = getFromColor((&param_22));
    let _e252 = C0_;
    C0_ = (_e252 + _e251);
    let _e254 = D;
    let _e256 = (*uv_2);
    param_23 = ((vec2<f32>(-0.322f, -0.933f) * _e254) + _e256);
    let _e258 = getToColor((&param_23));
    let _e259 = C1_;
    C1_ = (_e259 + _e258);
    let _e261 = D;
    let _e263 = (*uv_2);
    param_24 = ((vec2<f32>(-0.792f, -0.598f) * _e261) + _e263);
    let _e265 = getFromColor((&param_24));
    let _e266 = C0_;
    C0_ = (_e266 + _e265);
    let _e268 = D;
    let _e270 = (*uv_2);
    param_25 = ((vec2<f32>(-0.792f, -0.598f) * _e268) + _e270);
    let _e272 = getToColor((&param_25));
    let _e273 = C1_;
    C1_ = (_e273 + _e272);
    let _e275 = C0_;
    C0_ = (_e275 / vec4(13f));
    let _e278 = C1_;
    C1_ = (_e278 / vec4(13f));
    let _e281 = C0_;
    let _e282 = C1_;
    let _e283 = T;
    return mix(_e281, _e282, vec4(_e283));
}

fn main_1() {
    var param_26: vec2<f32>;

    let _e51 = _uv_1;
    param_26 = _e51;
    let _e52 = transition((&param_26));
    _fragColor = _e52;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
