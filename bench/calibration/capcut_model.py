"""Reference model of CapCut's renderer, as measured in docs/parity/calibration.md.

This is a numpy stand-in for the GPU compositor, used to check measurements; the engine
implements the same pipeline. Measured in calibration session 2 (CapCut 9.5):

- Frames are rendered natively at the export resolution (a 4K export of a 1080p canvas is
  drawn at 4K, not upscaled).
- Each image is first resampled to its displayed size:
  - downscale: area average (exact 2x2 box at 50%), then a 3x3 Laplacian sharpen of
    strength 0.15, clamped to 8 bits;
  - upscale: bilinear;
  - 1:1 passes through unchanged.
- That texture is then rotated and positioned in a second pass with bicubic
  (Catmull-Rom) interpolation.
- Text: em = size * CAPCUT_SIZE_UNIT_EM * canvas width.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CAPCUT_SIZE_UNIT_EM = 0.005789  # engine/crates/model/src/material.rs
DOWNSCALE_SHARPEN = 0.15
FONT = "/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf"


def _kernel(name):
    if name == "box":
        return 0.5, lambda x: (np.abs(x) < 0.5).astype(float)
    if name == "tent":
        return 1.0, lambda x: np.clip(1 - np.abs(x), 0, None)
    if name == "catrom":
        def f(x):
            x = np.abs(x)
            return np.where(x < 1, 1.5 * x**3 - 2.5 * x**2 + 1, np.where(x < 2, -0.5 * x**3 + 2.5 * x**2 - 4 * x + 2, 0.0))
        return 2.0, f
    raise ValueError(name)


def sample(src, inv, out_w, out_h, kernel, widen=1.0):
    """Resample premultiplied RGBA `src` through the inverse affine `inv` (3x3, dst px centre -> src px
    coords) with a separable kernel along the source axes; `widen` > 1 widens it for minification.
    Texels outside the source are transparent."""
    sh, sw = src.shape[:2]
    X, Y = np.meshgrid(np.arange(out_w) + 0.5, np.arange(out_h) + 0.5)
    u = inv[0, 0] * X + inv[0, 1] * Y + inv[0, 2]
    v = inv[1, 0] * X + inv[1, 1] * Y + inv[1, 2]
    R, fn = _kernel(kernel)
    r = int(np.ceil(R * widen)) + 1
    bu, bv = np.floor(u - 0.5).astype(int), np.floor(v - 0.5).astype(int)
    pad = r + 2
    padded = np.pad(src, ((pad, pad), (pad, pad), (0, 0)))
    acc = np.zeros((out_h, out_w, src.shape[2]))
    wsum = np.zeros((out_h, out_w))
    for j in range(-r + 1, r + 1):
        nv = bv + j
        wy = fn((nv + 0.5 - v) / widen)
        rows = np.clip(nv, -pad, sh + pad - 1) + pad
        for i in range(-r + 1, r + 1):
            nu = bu + i
            w = wy * fn((nu + 0.5 - u) / widen)
            if not w.any():
                continue
            acc += w[..., None] * padded[rows, np.clip(nu, -pad, sw + pad - 1) + pad]
            wsum += w
    return acc / np.where(wsum == 0, 1, wsum)[..., None]


def sharpen(img, a):
    """3x3 Laplacian sharpen, zero outside (transparent)."""
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)))
    return (1 + 4 * a) * img - a * (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:])


def resize_stage(src, tw, th):
    """Stage 1: resample the image to its displayed size (tw x th texels)."""
    sh, sw = src.shape[:2]
    if (tw, th) == (sw, sh):
        return src
    kx, ky = tw / sw, th / sh
    inv = np.array([[1 / kx, 0, 0], [0, 1 / ky, 0], [0, 0, 1]])
    if kx < 1 and ky < 1:
        out = sample(src, inv, tw, th, "box", widen=1 / min(kx, ky))
        return np.clip(np.round(sharpen(out, DOWNSCALE_SHARPEN)), 0, 255)
    return np.clip(np.round(sample(src, inv, tw, th, "tent")), 0, 255)


def draw_layer(canvas, rgba, tr, opacity=1.0):
    """Composite one image (uint8 RGBA array) onto `canvas` (float premultiplied RGB, export resolution)."""
    H, W = canvas.shape[:2]
    sh, sw = rgba.shape[:2]
    src = rgba.astype(float)
    src[..., :3] *= src[..., 3:4] / 255.0  # premultiply
    fit = min(W / sw, H / sh)  # scale 1 = contain-fit
    dw, dh = sw * fit * abs(tr["scale"]["value"]["x"]), sh * fit * abs(tr["scale"]["value"]["y"])
    tw, th = max(1, round(dw)), max(1, round(dh))
    tex = resize_stage(src, tw, th)
    if tr.get("flip_h"):
        tex = tex[:, ::-1]
    if tr.get("flip_v"):
        tex = tex[::-1]
    # Stage 2: place the texture (residual scale, rotation clockwise, position in half-canvas units, +y up).
    cx = W / 2 + tr["position"]["value"]["x"] * W / 2
    cy = H / 2 - tr["position"]["value"]["y"] * H / 2
    t = np.radians(tr["rotation"]["value"])
    sx, sy = dw / tw, dh / th
    c, s = np.cos(t), np.sin(t)
    # dst -> texture: rotate back, unscale, recentre
    inv = np.array([[c / sx, s / sx, 0], [-s / sy, c / sy, 0], [0, 0, 1]], float)
    inv[0, 2] = -(c * cx + s * cy) / sx + tw / 2
    inv[1, 2] = -(-s * cx + c * cy) / sy + th / 2
    layer = sample(tex, inv, W, H, "catrom")
    layer = np.clip(layer, 0, 255) * opacity
    a = np.clip(layer[..., 3:4] / 255.0, 0, 1)
    return canvas * (1 - a) + layer[..., :3]


def draw_text(frame, text, run, tr):
    """Draw a single-run text with CapCut's font at the exact (unrounded) em size."""
    W, H = frame.size
    em = run["size"] * CAPCUT_SIZE_UNIT_EM * W
    font = ImageFont.truetype(FONT, size=em)
    cx = W / 2 + tr["position"]["value"]["x"] * W / 2
    cy = H / 2 - tr["position"]["value"]["y"] * H / 2
    fill = tuple(round(c * 255) for c in (run["fill"]["r"], run["fill"]["g"], run["fill"]["b"]))
    ImageDraw.Draw(frame).text((cx, cy), text, font=font, fill=fill, anchor="mm")


def active(project, t_us, kind):
    for track in project["tracks"]:
        if track["kind"] != kind or track["hidden"]:
            continue
        for seg in track["segments"]:
            start, dur = seg["target"]["start"], seg["target"]["duration"]
            if start <= t_us < start + dur:
                yield seg


def media_path(project, mid):
    return next(m["path"] for m in project["materials"]["media"] if m["id"] == mid)


def render(project, t, width, height):
    """Render the imported OpenRip project at time t (seconds) at the export resolution."""
    canvas = np.zeros((height, width, 3))
    t_us = int(round(t * 1_000_000))
    for seg in sorted(active(project, t_us, "video"), key=lambda s: s["render_index"]):
        if not seg.get("visible", True):
            continue
        rgba = np.asarray(Image.open(media_path(project, seg["material"])).convert("RGBA"))
        canvas = draw_layer(canvas, rgba, seg["transform"], seg.get("opacity", {}).get("value", 1.0))
    frame = Image.fromarray(np.clip(np.round(canvas), 0, 255).astype(np.uint8))
    for seg in active(project, t_us, "text"):
        text = next(x for x in project["materials"]["texts"] if x["id"] == seg["material"])
        draw_text(frame, text["text"], text["runs"][0], seg["transform"])
    return frame
