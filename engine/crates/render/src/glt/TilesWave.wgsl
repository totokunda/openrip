// TilesWave — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/TilesWave.glsl
// Author: numb3r23
// License: MIT
// Description: The incoming image is revealed tile by tile in a diagonal wave
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    tileCount: vec2<i32>,
    flipX: i32,
    flipY: i32,
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
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn getFromColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn transition(uv_2: ptr<function, vec2<f32>>) -> vec4<f32> {
    var tileSize: vec2<f32>;
    var posInTile: vec2<f32>;
    var tileNum: vec2<f32>;
    var countTiles: f32;
    var offset: f32;
    var timeOffset: f32;
    var sinTime: f32;
    var texC: vec2<f32>;
    var param: vec2<f32>;
    var local: f32;
    var param_1: vec2<f32>;
    var local_1: f32;
    var globalUV: vec2<f32>;
    var param_2: vec2<f32>;
    var param_3: vec2<f32>;
    var local_2: f32;
    var param_4: vec2<f32>;
    var local_3: f32;
    var globalUV_1: vec2<f32>;
    var param_5: vec2<f32>;
    var phi_149_: bool;
    var phi_199_: bool;
    var phi_261_: bool;
    var phi_314_: bool;

    let _e38 = uniforms.tileCount;
    tileSize = (vec2(1f) / vec2<f32>(_e38));
    let _e42 = (*uv_2);
    let _e44 = uniforms.tileCount;
    posInTile = fract((_e42 * vec2<f32>(_e44)));
    let _e48 = (*uv_2);
    let _e50 = uniforms.tileCount;
    tileNum = floor((_e48 * vec2<f32>(_e50)));
    let _e56 = uniforms.tileCount[0u];
    let _e59 = uniforms.tileCount[1u];
    countTiles = f32((_e56 * _e59));
    let _e63 = tileNum[1u];
    let _e65 = tileNum[0u];
    let _e68 = uniforms.tileCount[1u];
    let _e72 = countTiles;
    offset = ((_e63 + (_e65 * f32(_e68))) / _e72);
    let _e75 = uniforms.progress;
    let _e76 = offset;
    let _e78 = countTiles;
    timeOffset = clamp(((_e75 - _e76) * _e78), 0f, 0.5f);
    let _e81 = timeOffset;
    sinTime = (1f - abs(cos((fract(_e81) * 3.1415925f))));
    let _e87 = posInTile;
    texC = _e87;
    let _e88 = sinTime;
    if (_e88 <= 0.5f) {
        let _e91 = uniforms.flipX;
        if (_e91 != 0i) {
            let _e94 = texC[0u];
            let _e95 = sinTime;
            let _e96 = (_e94 < _e95);
            phi_149_ = _e96;
            if !(_e96) {
                let _e99 = texC[0u];
                let _e100 = sinTime;
                phi_149_ = (_e99 > (1f - _e100));
            }
            let _e104 = phi_149_;
            if _e104 {
                let _e105 = (*uv_2);
                param = _e105;
                let _e106 = getFromColor((&param));
                return _e106;
            }
            let _e108 = texC[0u];
            if (_e108 < 0.5f) {
                let _e111 = texC[0u];
                let _e112 = sinTime;
                let _e115 = sinTime;
                local = (((_e111 - _e112) * 0.5f) / (0.5f - _e115));
            } else {
                let _e119 = texC[0u];
                let _e122 = sinTime;
                local = ((((_e119 - 0.5f) * 0.5f) / (0.5f - _e122)) + 0.5f);
            }
            let _e126 = local;
            texC[0u] = _e126;
        }
        let _e129 = uniforms.flipY;
        if (_e129 != 0i) {
            let _e132 = texC[1u];
            let _e133 = sinTime;
            let _e134 = (_e132 < _e133);
            phi_199_ = _e134;
            if !(_e134) {
                let _e137 = texC[1u];
                let _e138 = sinTime;
                phi_199_ = (_e137 > (1f - _e138));
            }
            let _e142 = phi_199_;
            if _e142 {
                let _e143 = (*uv_2);
                param_1 = _e143;
                let _e144 = getFromColor((&param_1));
                return _e144;
            }
            let _e146 = texC[1u];
            if (_e146 < 0.5f) {
                let _e149 = texC[1u];
                let _e150 = sinTime;
                let _e153 = sinTime;
                local_1 = (((_e149 - _e150) * 0.5f) / (0.5f - _e153));
            } else {
                let _e157 = texC[1u];
                let _e160 = sinTime;
                local_1 = ((((_e157 - 0.5f) * 0.5f) / (0.5f - _e160)) + 0.5f);
            }
            let _e164 = local_1;
            texC[1u] = _e164;
        }
        let _e166 = tileNum;
        let _e167 = tileSize;
        let _e169 = texC;
        let _e170 = tileSize;
        globalUV = ((_e166 * _e167) + (_e169 * _e170));
        let _e173 = globalUV;
        param_2 = _e173;
        let _e174 = getFromColor((&param_2));
        return _e174;
    } else {
        let _e176 = uniforms.flipX;
        if (_e176 != 0i) {
            let _e179 = texC[0u];
            let _e180 = sinTime;
            let _e181 = (_e179 > _e180);
            phi_261_ = _e181;
            if !(_e181) {
                let _e184 = texC[0u];
                let _e185 = sinTime;
                phi_261_ = (_e184 < (1f - _e185));
            }
            let _e189 = phi_261_;
            if _e189 {
                let _e190 = (*uv_2);
                param_3 = _e190;
                let _e191 = getToColor((&param_3));
                return _e191;
            }
            let _e193 = texC[0u];
            if (_e193 < 0.5f) {
                let _e196 = texC[0u];
                let _e197 = sinTime;
                let _e200 = sinTime;
                local_2 = (((_e196 - _e197) * 0.5f) / (0.5f - _e200));
            } else {
                let _e204 = texC[0u];
                let _e207 = sinTime;
                local_2 = ((((_e204 - 0.5f) * 0.5f) / (0.5f - _e207)) + 0.5f);
            }
            let _e211 = local_2;
            texC[0u] = _e211;
            let _e214 = texC[0u];
            texC[0u] = (1f - _e214);
        }
        let _e218 = uniforms.flipY;
        if (_e218 != 0i) {
            let _e221 = texC[1u];
            let _e222 = sinTime;
            let _e223 = (_e221 > _e222);
            phi_314_ = _e223;
            if !(_e223) {
                let _e226 = texC[1u];
                let _e227 = sinTime;
                phi_314_ = (_e226 < (1f - _e227));
            }
            let _e231 = phi_314_;
            if _e231 {
                let _e232 = (*uv_2);
                param_4 = _e232;
                let _e233 = getToColor((&param_4));
                return _e233;
            }
            let _e235 = texC[1u];
            if (_e235 < 0.5f) {
                let _e238 = texC[1u];
                let _e239 = sinTime;
                let _e242 = sinTime;
                local_3 = (((_e238 - _e239) * 0.5f) / (0.5f - _e242));
            } else {
                let _e246 = texC[1u];
                let _e249 = sinTime;
                local_3 = ((((_e246 - 0.5f) * 0.5f) / (0.5f - _e249)) + 0.5f);
            }
            let _e253 = local_3;
            texC[1u] = _e253;
            let _e256 = texC[1u];
            texC[1u] = (1f - _e256);
        }
        let _e259 = tileNum;
        let _e260 = tileSize;
        let _e262 = texC;
        let _e263 = tileSize;
        globalUV_1 = ((_e259 * _e260) + (_e262 * _e263));
        let _e266 = globalUV_1;
        param_5 = _e266;
        let _e267 = getToColor((&param_5));
        return _e267;
    }
}

fn main_1() {
    var param_6: vec2<f32>;

    let _e17 = _uv_1;
    param_6 = _e17;
    let _e18 = transition((&param_6));
    _fragColor = _e18;
    return;
}

@fragment 
fn main(@location(0) _uv: vec2<f32>) -> @location(0) vec4<f32> {
    _uv_1 = _uv;
    main_1();
    let _e3 = _fragColor;
    return _e3;
}
