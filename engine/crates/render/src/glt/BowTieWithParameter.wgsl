// BowTieWithParameter — WGSL, generated from https://github.com/gl-transitions/gl-transitions/blob/master/transitions/BowTieWithParameter.glsl
// Author: KMojek
// License: MIT
// Description: A bow-tie wipe with an adjustable shape that can run in reverse
// Bindings and uniform layout: see the gl-transitions package README

struct Uniforms {
    progress: f32,
    ratio: f32,
    adjust: f32,
    reverse: i32,
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
    let _e18 = (*uv)[0u];
    let _e20 = (*uv)[1u];
    let _e23 = textureSampleLevel(_from, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn getToColor(uv_1: ptr<function, vec2<f32>>) -> vec4<f32> {
    let _e18 = (*uv_1)[0u];
    let _e20 = (*uv_1)[1u];
    let _e23 = textureSampleLevel(_to, _sampler, vec2<f32>(_e18, (1f - _e20)), 0f);
    return _e23;
}

fn check(p1_: ptr<function, vec2<f32>>, p2_: ptr<function, vec2<f32>>, p3_: ptr<function, vec2<f32>>) -> f32 {
    let _e20 = (*p1_)[0u];
    let _e22 = (*p3_)[0u];
    let _e25 = (*p2_)[1u];
    let _e27 = (*p3_)[1u];
    let _e31 = (*p2_)[0u];
    let _e33 = (*p3_)[0u];
    let _e36 = (*p1_)[1u];
    let _e38 = (*p3_)[1u];
    return (((_e20 - _e22) * (_e25 - _e27)) - ((_e31 - _e33) * (_e36 - _e38)));
}

fn pointInTriangle(pt: ptr<function, vec2<f32>>, p1_1: ptr<function, vec2<f32>>, p2_1: ptr<function, vec2<f32>>, p3_1: ptr<function, vec2<f32>>) -> bool {
    var b1_: bool;
    var param: vec2<f32>;
    var param_1: vec2<f32>;
    var param_2: vec2<f32>;
    var b2_: bool;
    var param_3: vec2<f32>;
    var param_4: vec2<f32>;
    var param_5: vec2<f32>;
    var b3_: bool;
    var param_6: vec2<f32>;
    var param_7: vec2<f32>;
    var param_8: vec2<f32>;

    let _e32 = (*pt);
    param = _e32;
    let _e33 = (*p1_1);
    param_1 = _e33;
    let _e34 = (*p2_1);
    param_2 = _e34;
    let _e35 = check((&param), (&param_1), (&param_2));
    b1_ = (_e35 < 0f);
    let _e37 = (*pt);
    param_3 = _e37;
    let _e38 = (*p2_1);
    param_4 = _e38;
    let _e39 = (*p3_1);
    param_5 = _e39;
    let _e40 = check((&param_3), (&param_4), (&param_5));
    b2_ = (_e40 < 0f);
    let _e42 = (*pt);
    param_6 = _e42;
    let _e43 = (*p3_1);
    param_7 = _e43;
    let _e44 = (*p1_1);
    param_8 = _e44;
    let _e45 = check((&param_6), (&param_7), (&param_8));
    b3_ = (_e45 < 0f);
    let _e47 = b1_;
    let _e48 = b2_;
    let _e50 = b2_;
    let _e51 = b3_;
    return ((_e47 == _e48) && (_e50 == _e51));
}

fn transition_firstHalf(uv_2: ptr<function, vec2<f32>>, prog: ptr<function, f32>) -> vec4<f32> {
    var botLeft: vec2<f32>;
    var botRight: vec2<f32>;
    var tip: vec2<f32>;
    var param_9: vec2<f32>;
    var param_10: vec2<f32>;
    var param_11: vec2<f32>;
    var param_12: vec2<f32>;
    var param_13: vec2<f32>;
    var topLeft: vec2<f32>;
    var topRight: vec2<f32>;
    var tip_1: vec2<f32>;
    var param_14: vec2<f32>;
    var param_15: vec2<f32>;
    var param_16: vec2<f32>;
    var param_17: vec2<f32>;
    var param_18: vec2<f32>;
    var param_19: vec2<f32>;

    let _e36 = (*uv_2)[1u];
    if (_e36 < 0.5f) {
        let _e38 = (*prog);
        botLeft = vec2<f32>(-0f, (_e38 - 0.5f));
        let _e41 = (*prog);
        botRight = vec2<f32>(1f, (_e41 - 0.5f));
        let _e45 = uniforms.adjust;
        let _e46 = (*prog);
        tip = vec2<f32>(_e45, _e46);
        let _e48 = (*uv_2);
        param_9 = _e48;
        let _e49 = botLeft;
        param_10 = _e49;
        let _e50 = botRight;
        param_11 = _e50;
        let _e51 = tip;
        param_12 = _e51;
        let _e52 = pointInTriangle((&param_9), (&param_10), (&param_11), (&param_12));
        if _e52 {
            let _e53 = (*uv_2);
            param_13 = _e53;
            let _e54 = getToColor((&param_13));
            return _e54;
        }
    } else {
        let _e55 = (*prog);
        topLeft = vec2<f32>(-0f, ((1f - _e55) + 0.5f));
        let _e59 = (*prog);
        topRight = vec2<f32>(1f, ((1f - _e59) + 0.5f));
        let _e64 = uniforms.adjust;
        let _e65 = (*prog);
        tip_1 = vec2<f32>(_e64, (1f - _e65));
        let _e68 = (*uv_2);
        param_14 = _e68;
        let _e69 = topLeft;
        param_15 = _e69;
        let _e70 = topRight;
        param_16 = _e70;
        let _e71 = tip_1;
        param_17 = _e71;
        let _e72 = pointInTriangle((&param_14), (&param_15), (&param_16), (&param_17));
        if _e72 {
            let _e73 = (*uv_2);
            param_18 = _e73;
            let _e74 = getToColor((&param_18));
            return _e74;
        }
    }
    let _e75 = (*uv_2);
    param_19 = _e75;
    let _e76 = getFromColor((&param_19));
    return _e76;
}

fn transition_secondHalf(uv_3: ptr<function, vec2<f32>>, prog_1: ptr<function, f32>) -> vec4<f32> {
    var top: vec2<f32>;
    var bot: vec2<f32>;
    var tip_2: vec2<f32>;
    var param_20: vec2<f32>;
    var param_21: vec2<f32>;
    var param_22: vec2<f32>;
    var param_23: vec2<f32>;
    var param_24: vec2<f32>;
    var top_1: vec2<f32>;
    var bot_1: vec2<f32>;
    var tip_3: vec2<f32>;
    var param_25: vec2<f32>;
    var param_26: vec2<f32>;
    var param_27: vec2<f32>;
    var param_28: vec2<f32>;
    var param_29: vec2<f32>;
    var param_30: vec2<f32>;

    let _e36 = (*uv_3)[0u];
    let _e38 = uniforms.adjust;
    if (_e36 > _e38) {
        let _e40 = (*prog_1);
        top = vec2<f32>((_e40 + 0.5f), 1f);
        let _e43 = (*prog_1);
        bot = vec2<f32>((_e43 + 0.5f), -0f);
        let _e47 = uniforms.adjust;
        let _e48 = (*prog_1);
        tip_2 = vec2<f32>(mix(_e47, 1f, (2f * (_e48 - 0.5f))), 0.5f);
        let _e53 = (*uv_3);
        param_20 = _e53;
        let _e54 = top;
        param_21 = _e54;
        let _e55 = bot;
        param_22 = _e55;
        let _e56 = tip_2;
        param_23 = _e56;
        let _e57 = pointInTriangle((&param_20), (&param_21), (&param_22), (&param_23));
        if _e57 {
            let _e58 = (*uv_3);
            param_24 = _e58;
            let _e59 = getFromColor((&param_24));
            return _e59;
        }
    } else {
        let _e60 = (*prog_1);
        top_1 = vec2<f32>(((1f - _e60) - 0.5f), 1f);
        let _e64 = (*prog_1);
        bot_1 = vec2<f32>(((1f - _e64) - 0.5f), -0f);
        let _e69 = uniforms.adjust;
        let _e70 = (*prog_1);
        tip_3 = vec2<f32>(mix(_e69, 0f, (2f * (_e70 - 0.5f))), 0.5f);
        let _e75 = (*uv_3);
        param_25 = _e75;
        let _e76 = top_1;
        param_26 = _e76;
        let _e77 = bot_1;
        param_27 = _e77;
        let _e78 = tip_3;
        param_28 = _e78;
        let _e79 = pointInTriangle((&param_25), (&param_26), (&param_27), (&param_28));
        if _e79 {
            let _e80 = (*uv_3);
            param_29 = _e80;
            let _e81 = getFromColor((&param_29));
            return _e81;
        }
    }
    let _e82 = (*uv_3);
    param_30 = _e82;
    let _e83 = getToColor((&param_30));
    return _e83;
}

fn transition(uv_4: ptr<function, vec2<f32>>) -> vec4<f32> {
    var local: vec4<f32>;
    var param_31: vec2<f32>;
    var param_32: f32;
    var param_33: vec2<f32>;
    var param_34: f32;
    var local_1: vec4<f32>;
    var param_35: vec2<f32>;
    var param_36: f32;
    var param_37: vec2<f32>;
    var param_38: f32;

    let _e28 = uniforms.reverse;
    if (_e28 != 0i) {
        let _e31 = uniforms.progress;
        if (_e31 < 0.5f) {
            let _e34 = uniforms.progress;
            let _e36 = (*uv_4);
            param_31 = _e36;
            param_32 = (1f - _e34);
            let _e37 = transition_secondHalf((&param_31), (&param_32));
            local = _e37;
        } else {
            let _e39 = uniforms.progress;
            let _e41 = (*uv_4);
            param_33 = _e41;
            param_34 = (1f - _e39);
            let _e42 = transition_firstHalf((&param_33), (&param_34));
            local = _e42;
        }
        let _e43 = local;
        return _e43;
    } else {
        let _e45 = uniforms.progress;
        if (_e45 < 0.5f) {
            let _e47 = (*uv_4);
            param_35 = _e47;
            let _e49 = uniforms.progress;
            param_36 = _e49;
            let _e50 = transition_firstHalf((&param_35), (&param_36));
            local_1 = _e50;
        } else {
            let _e51 = (*uv_4);
            param_37 = _e51;
            let _e53 = uniforms.progress;
            param_38 = _e53;
            let _e54 = transition_secondHalf((&param_37), (&param_38));
            local_1 = _e54;
        }
        let _e55 = local_1;
        return _e55;
    }
}

fn main_1() {
    var param_39: vec2<f32>;

    let _e17 = _uv_1;
    param_39 = _e17;
    let _e18 = transition((&param_39));
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
