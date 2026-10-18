// CapCut's chroma key (Remove BG › Chroma key), reimplemented from reading the bundle that
// ships with CapCut (`Resources/Chroma2`; docs/parity/compositing.md). Three passes over the
// clip's own picture, before its colour grade:
//
// 1. fs_chroma_key: how far each pixel is from the picked colour, as a matte (1 keeps it),
//    in the red channel.
// 2. fs_chroma_smooth_x: the matte averaged across a row (with that span's largest and
//    smallest values) when the edge is smoothed; the matte as it is otherwise.
// 3. fs_chroma_smooth_y: the same down a column, stretched about a threshold within those
//    bounds, then the spill taken off the colour, and the picture times the matte.
//
// The picture comes premultiplied (opaque video mostly); each pass reads it straight.

struct ChromaParams {
    // The picked colour (straight, 0…1).
    colour: vec4<f32>,
    // intensity, shadow, edge smoothing, spill (0…1)
    amounts: vec4<f32>,
    // x, y: the picture's size in pixels
    size: vec4<f32>,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> C: ChromaParams;
// The matte (pass 2) or the smoothed rows (pass 3).
@group(0) @binding(2) var aux: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
}

const EPS: f32 = 0.001;

fn straight(p: vec2<i32>) -> vec4<f32> {
    let px = textureLoad(src, p, 0);
    return select(px, vec4<f32>(px.rgb / px.a, px.a), px.a > 0.0);
}

fn aux_at(p: vec2<i32>) -> vec4<f32> {
    let d = vec2<i32>(textureDimensions(aux));
    return textureLoad(aux, clamp(p, vec2<i32>(0), d - vec2<i32>(1)), 0);
}

// BT.601 luma and colour differences, the differences centred on ½.
fn yuv(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        dot(c, vec3<f32>(0.299, 0.587, 0.114)),
        dot(c, vec3<f32>(-0.14710802, -0.28880402, 0.435912)) + 0.5,
        dot(c, vec3<f32>(0.61477697, -0.514799, -0.099978)) + 0.5,
    );
}

fn rgb_of_yuv(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(c.x + 1.14 * c.z - 0.57, c.x - 0.395 * c.y - 0.581 * c.z + 0.488, c.x + 2.032 * c.y - 1.016);
}

// Hue, saturation and value, hue in 0…1 (the branchless conversion).
fn hsv(c: vec3<f32>) -> vec3<f32> {
    let k = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4<f32>(c.bg, k.wz), vec4<f32>(c.gb, k.xy), step(c.b, c.g));
    let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn rgb_of_hsv(c: vec3<f32>) -> vec3<f32> {
    // GLSL's mod (floored), which WGSL's % (truncated) isn't for negative values.
    let x = vec3<f32>(c.x * 6.0) + vec3<f32>(0.0, 4.0, 2.0);
    let m = x - 6.0 * floor(x / 6.0);
    let k = clamp(abs(m - 3.0) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0));
    return c.z * mix(vec3<f32>(1.0), k, c.y);
}

fn wrap_hue(h: f32) -> f32 {
    if (h > 1.0) {
        return h - 1.0;
    }
    if (h < 0.0) {
        return h + 1.0;
    }
    return h;
}

// The matte: 1 keeps a pixel, 0 keys it out.
fn matte(c: vec3<f32>, key: vec3<f32>, intensity: f32, shadow: f32) -> f32 {
    let col = clamp(yuv(c), vec3<f32>(0.0), vec3<f32>(1.0));
    let k = yuv(key);
    let strong = clamp(3.0 * (intensity - 0.15), 0.0, 1.0);
    let on = clamp(10.0 * (intensity - 0.05), 0.0, 1.0);
    // How saturated the key is, and a second key point pushed further out along its hue.
    let sat_key = length(vec2<f32>(0.5) - k.yz);
    let reach = max(1.0, min(10.0, 2.0 / max(0.1, sat_key)));
    let far = (k.yz - vec2<f32>(0.5)) * (1.0 + on * intensity * reach) + vec2<f32>(0.5);
    let gain = sqrt(intensity) * 1.8;
    let width = mix(0.05, max(0.1, 0.18 - 0.1 * col.x * k.x + 0.01), on);
    let span = length(far - k.yz);
    var d = length(col.yz - k.yz) + length(col.yz - far);
    let sb = min(max(sat_key, 0.05), 0.6);
    var weight_sb = clamp(col.x / max(0.2, k.x), 0.0, 1.0) * (1.0 - clamp(sat_key * sat_key * 4.0, 0.0, 1.0));
    weight_sb = mix(weight_sb, 0.0, clamp((intensity - 0.4) * 5.0, 0.0, 1.0));
    d = max(0.0, (d - span) - sb * mix(1.0, sb, weight_sb) * gain);
    // From the colour difference, and from the luma difference for a grey key.
    let a_uv = pow(max(d / width, 0.0), 2.0 - 1.4 * sat_key);
    let a_y = 14.2857 * (abs(col.x - k.x) / max(1.0 - k.x, k.x) - 0.2 * gain * gain);
    var weight_y = clamp(1.5 - sat_key * 20.0, 0.0, 1.0);
    // From the hue, for a key with some colour.
    let h = hsv(c);
    let hk = hsv(key);
    let hue_weight = clamp(15.0 * (hk.y * hk.z - 0.02), 0.0, 1.0);
    var a_hsv = 0.0;
    weight_y = mix(1.0, max(weight_y, 1.0 - hue_weight), strong);
    if (hue_weight > 0.001) {
        let dh = min(abs(h.x - hk.x), 1.0 - abs(h.x - hk.x));
        let near = clamp((dh - (0.12 + 0.1 * clamp((intensity - 0.4) * 2.0, 0.0, 1.0))) * 12.0, 0.0, 1.0);
        let pale = (hk.y * hk.z - 0.1) * (1.0 - intensity) * (1.0 - intensity);
        let k_sv = 10.0 + 50.0 * clamp(intensity - 0.4, 0.0, 1.0);
        a_hsv = 1.0 - clamp(k_sv * (h.y * h.z - pale), 0.0, 1.0);
        a_hsv = 1.0 - (1.0 - near) * (1.0 - a_hsv);
        a_hsv = hue_weight * mix(a_hsv, 0.0, clamp((intensity - 0.85) * 8.0, 0.0, 1.0));
        weight_y = weight_y * mix(1.0, 1.0 - clamp(25.0 * (hk.y * hk.z - 0.25), 0.0, 1.0), clamp(intensity * 10.0, 0.0, 1.0));
    }
    var a = max(a_hsv, max(a_y * weight_y, a_uv));
    let steep = clamp((intensity - 0.5) * 4.0, 0.0, 1.0) + 1.0;
    a = min(a, clamp((a - 0.5) * steep + 0.4, 0.0, 1.0));
    // Shadow: keeps pixels whose point in the HSV cone (value up its axis, saturation × value
    // out from it at the hue's angle) lies far from a point above the cone, the key's darker
    // shades among them (shadows cast on the screen), more of them with more shadow.
    if (shadow > 0.001) {
        let z = h.z * 1.73205 / 3.0;
        let x = cos(h.x * 6.2831853) * h.y * h.z;
        let y = sin(h.x * 6.2831853) * h.y * h.z;
        let dist = length(vec3<f32>(x, y, z) - vec3<f32>(0.0, 0.0, 1.73205 * 1.33333333));
        let sh = 1.0 / (1.0 + exp(-(shadow - 0.3) * 4.0));
        let edge = mix(1.73205 * 1.33333, 2.0, sh);
        a = max(1.0 - min(exp(30.0 * (edge - dist)), 1.0), a);
    }
    return clamp((a - 0.2) * 1.25, 0.0, 1.0);
}

@fragment
fn fs_chroma_key(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let intensity = C.amounts.x;
    if (intensity < EPS) {
        return vec4<f32>(1.0);
    }
    let a = matte(straight(vec2<i32>(floor(pos.xy))).rgb, C.colour.rgb, intensity, C.amounts.y);
    return vec4<f32>(a, a, a, 1.0);
}

// The span edge smoothing averages over: 1.4% of the picture's shorter side at full
// smoothing, either side of the pixel.
fn radius() -> i32 {
    return i32(C.amounts.z * min(C.size.x, C.size.y) * 0.014);
}

@fragment
fn fs_chroma_smooth_x(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let a = aux_at(p).x;
    if (C.amounts.x < EPS) {
        return vec4<f32>(1.0);
    }
    if (C.amounts.z < EPS) {
        return vec4<f32>(a, a, a, 1.0);
    }
    let r = radius();
    var sum = 0.0;
    var hi = a;
    var lo = a;
    for (var i = -r; i <= r; i++) {
        let v = aux_at(p + vec2<i32>(i, 0)).x;
        sum += v;
        hi = max(hi, v);
        lo = min(lo, v);
    }
    return vec4<f32>(clamp(sum / max(0.001, f32(2 * r + 1)), 0.0, 1.0), hi, lo, 1.0);
}

// The spill taken off a colour: its hue turned so the key sits on green, the green cast
// removed against the key, then turned back (CapCut's processColor).
fn despill(rgba: vec3<f32>, key: vec3<f32>, a: f32, spill: f32) -> vec3<f32> {
    var base_yuv = yuv(rgba);
    base_yuv = vec3<f32>(base_yuv.x, 0.5, 0.5);
    var base = clamp(rgb_of_yuv(base_yuv), vec3<f32>(0.0), vec3<f32>(1.0));
    var h = hsv(rgba);
    var hk = hsv(key);
    // Hues with green's ±0.02 folded out.
    let d = 0.02;
    let fold = fn_fold(h.x, d);
    let fold_k = fn_fold(hk.x, d);
    let h_round = clamp(f32(i32(hk.x * 3.0 + 0.5)) / 3.0, 0.0, 1.0);
    let dh = min(abs(fold - fold_k), 1.0 - 2.0 * d - abs(fold - fold_k));
    if (spill > EPS) {
        base = mix(rgba, base, 1.0 - clamp((dh - 0.1) * 12.0, 0.0, 1.0));
    } else {
        base = rgba;
    }
    let offset = min(abs(h_round - 0.33333), 1.0 - abs(h_round - 0.33333));
    let sign = select(1.0, -1.0, hk.x > 0.33333 && hk.x < 0.83333);
    h.x = wrap_hue(h.x + sign * offset);
    let turned = rgb_of_hsv(h);
    hk.x = wrap_hue(hk.x + sign * offset);
    let key_turned = rgb_of_hsv(hk);
    let c_yuv = yuv(turned);
    let k_yuv = yuv(key_turned);
    let s_c = length(c_yuv.yz - vec2<f32>(0.5));
    let s_k = length(k_yuv.yz - vec2<f32>(0.5));
    let s = clamp(0.66 - 5.0 * s_c, 0.0, 1.0);
    var a_colour = 1.0 - green_excess(turned, 1.0 - (spill - 0.25) * (1.0 + s)) / max(0.01, green_excess(key_turned, 1.0));
    a_colour = clamp(max(a_colour, a / 3.0), 0.0001, 1.0);
    var fixed = (turned - (1.0 - a_colour) * key_turned) / a_colour;
    let hi_rb = max(fixed.r, fixed.b);
    let lo_rb = min(fixed.r, fixed.b);
    fixed.g = mix(fixed.g, min(fixed.g, (hi_rb - lo_rb) * 0.9 * hi_rb + lo_rb), spill);
    fixed = clamp(fixed, vec3<f32>(0.0), vec3<f32>(1.0));
    var f_yuv = yuv(fixed);
    let weight_y = min(1.0 - a, min(1.0, 1.0 - a_colour));
    var kuv = (1.0 - a_colour) * clamp(s_c * 10.0, 0.0, 1.0);
    kuv = mix(kuv, 1.0 - clamp((dh - 0.3) * 10.0, 0.0, 1.0), 1.0 - clamp((h.z - 0.05) * 2.0, 0.0, 1.0));
    f_yuv = vec3<f32>(f_yuv.x * weight_y + (1.0 - weight_y) * c_yuv.x, f_yuv.y * (1.0 - kuv) + kuv * 0.5, f_yuv.z * (1.0 - kuv) + kuv * 0.5);
    fixed = clamp(rgb_of_yuv(f_yuv), vec3<f32>(0.0), vec3<f32>(1.0));
    var fh = hsv(fixed);
    fh.x = wrap_hue(fh.x - sign * offset);
    fixed = rgb_of_hsv(fh);
    fixed = mix(fixed, base, 1.0 - min(1.0, 2.5 * spill));
    return mix(rgba, fixed, clamp(s_k * 10.0, 0.0, 1.0));
}

fn fn_fold(h: f32, d: f32) -> f32 {
    if (h < 0.33333 + d && h > 0.33333 - d) {
        return 0.33333 - d;
    }
    if (h >= 0.33333 + d) {
        return h - 2.0 * d;
    }
    return h;
}

// How much green exceeds red and blue, against a line through them scaled by `c`.
fn green_excess(c: vec3<f32>, k: f32) -> f32 {
    let hi = max(c.r, c.b);
    let lo = min(c.r, c.b);
    return clamp(c.g - ((hi - lo) * k * hi + lo), 0.0, 1.0);
}

@fragment
fn fs_chroma_smooth_y(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(floor(pos.xy));
    let px = straight(p);
    let rows = aux_at(p);
    var a = rows.x;
    let intensity = C.amounts.x;
    let smoothing = C.amounts.z;
    if (intensity > EPS && smoothing > EPS) {
        let r = radius();
        var sum = 0.0;
        var hi = rows.y;
        var lo = rows.z;
        for (var i = -r; i <= r; i++) {
            let v = aux_at(p + vec2<i32>(0, i)).x;
            sum += v;
            hi = max(hi, v);
            lo = min(lo, v);
        }
        let t = 0.5 + smoothing / 3.0;
        let soft = clamp((clamp(sum / max(0.001, f32(2 * r + 1)), 0.0, 1.0) - t) * (f32(r) / 5.0 + 1.0) + t, lo, hi);
        a = mix(min(a, soft), soft, clamp(7.0 * smoothing, 0.0, 1.0));
    }
    // CapCut's pass premultiplies the picture, takes the spill off it, and multiplies it
    // by the matte (and the alpha by the picture's alpha once more).
    var rgb = px.rgb * px.a;
    if (C.amounts.w > EPS) {
        rgb = despill(rgb, C.colour.rgb, a, C.amounts.w);
    }
    return vec4<f32>(rgb * a, px.a * a * px.a);
}
