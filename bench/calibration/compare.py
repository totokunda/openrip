"""Compare CapCut's exported frames with a reference render of OpenRip's imported project.

The reference render is a stand-in (numpy/Pillow), not the Rust engine: it draws each
segment straight from the imported project JSON using the model's conventions, to check
that the importer reads CapCut's draft the way CapCut renders it.

To compare like with like, the reference frame goes through the same export path as
CapCut's (H.264 High, 4:2:0, BT.709, TV range), and both are decoded with identical
settings. Images are drawn with an exact sub-pixel affine transform (single bilinear
pass, 4x4 supersampled edges); text uses CapCut's own font at the exact (unrounded) size.

    python3 bench/calibration/compare.py <imported-project.json> <capcut-export.mp4> <out-dir>
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

CAPCUT_SIZE_UNIT_EM = 0.005789  # engine/crates/model/src/material.rs
FONT = "/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf"


def decode_frame(video, t):
    """Decode one frame as full-range RGB, interpreting the stream as BT.709 TV range."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", video, "-frames:v", "1",
                          "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24",
                          "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    side = int(round((len(raw) // 3) ** 0.5))
    return Image.fromarray(np.frombuffer(raw, np.uint8).reshape(side, side, 3))


def through_export(img, workdir, name):
    """Encode like CapCut's export (H.264 High, yuv420p, BT.709, TV range) and decode back."""
    png, mp4 = workdir / f"{name}.png", workdir / f"{name}.mp4"
    img.save(png)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "2", "-i", str(png),
                    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
                    "-c:v", "libx264", "-profile:v", "high", "-b:v", "2800k", "-bf", "2",
                    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                    str(mp4)], check=True)
    return decode_frame(str(mp4), 1.0)


def draw_image(canvas, src, tr, ss=4):
    """Exact affine draw of `src` (RGBA float) onto `canvas` (RGB float), ss×ss samples per pixel."""
    H, W = canvas.shape[:2]
    sh, sw = src.shape[:2]
    fit = min(W / sw, H / sh)  # scale 1 = contain-fit
    kx, ky = tr["scale"]["value"]["x"] * fit, tr["scale"]["value"]["y"] * fit
    cx = W / 2 + tr["position"]["value"]["x"] * W / 2
    cy = H / 2 - tr["position"]["value"]["y"] * H / 2  # +y up
    t = np.radians(tr["rotation"]["value"])  # clockwise on screen
    gx, gy = (np.arange(W * ss) + 0.5) / ss, (np.arange(H * ss) + 0.5) / ss
    X, Y = np.meshgrid(gx, gy)
    dx, dy = X - cx, Y - cy
    u = (np.cos(t) * dx + np.sin(t) * dy) / kx + sw / 2
    v = (-np.sin(t) * dx + np.cos(t) * dy) / ky + sh / 2
    inside = (u >= 0) & (u < sw) & (v >= 0) & (v < sh)
    uu, vv = np.clip(u - 0.5, 0, sw - 1), np.clip(v - 0.5, 0, sh - 1)
    x0, y0 = np.floor(uu).astype(int), np.floor(vv).astype(int)
    x1, y1 = np.minimum(x0 + 1, sw - 1), np.minimum(y0 + 1, sh - 1)
    fx, fy = (uu - x0)[..., None], (vv - y0)[..., None]
    c = (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x1] * fx * (1 - fy)
         + src[y1, x0] * (1 - fx) * fy + src[y1, x1] * fx * fy)
    alpha = np.where(inside, c[..., 3] / 255.0, 0.0)[..., None]
    layer = (c[..., :3] * alpha).reshape(H, ss, W, ss, 3).mean(axis=(1, 3))
    cover = alpha.reshape(H, ss, W, ss, 1).mean(axis=(1, 3))
    return canvas * (1 - cover) + layer


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


def render(project, t, size):
    W = H = size
    canvas = np.zeros((H, W, 3))
    t_us = int(t * 1_000_000)
    # Video/photo segments, in stacking order.
    for seg in sorted(active(project, t_us, "video"), key=lambda s: s["render_index"]):
        src = np.asarray(Image.open(media_path(project, seg["material"])).convert("RGBA")).astype(float)
        canvas = draw_image(canvas, src, seg["transform"])
    frame = Image.fromarray(np.clip(np.round(canvas), 0, 255).astype(np.uint8))
    # Text segments.
    for seg in active(project, t_us, "text"):
        text = next(x for x in project["materials"]["texts"] if x["id"] == seg["material"])
        run = text["runs"][0]
        em = run["size"] * CAPCUT_SIZE_UNIT_EM * H
        font = ImageFont.truetype(FONT, size=em)
        tr = seg["transform"]
        cx = W / 2 + tr["position"]["value"]["x"] * W / 2
        cy = H / 2 - tr["position"]["value"]["y"] * H / 2
        fill = tuple(round(c * 255) for c in (run["fill"]["r"], run["fill"]["g"], run["fill"]["b"]))
        ImageDraw.Draw(frame).text((cx, cy), text["text"], font=font, fill=fill, anchor="mm")
    return frame


def compare(a, b):
    x, y = np.asarray(a).astype(float), np.asarray(b).astype(float)
    mse = np.mean((x - y) ** 2)
    psnr = 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
    diff = np.abs(x - y).max(axis=2)
    return psnr, float((diff > 64).mean() * 100), Image.fromarray(np.clip(diff * 2, 0, 255).astype(np.uint8)).convert("RGB")


def main():
    project = json.load(open(sys.argv[1]))
    video, out = sys.argv[2], Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    rows, label_h, cell = [], 44, 540
    for t, what in [(1.0, "marker (position, scale, rotation)"), (3.0, "default text (size 15)")]:
        cap = decode_frame(video, t)
        cap.save(out / f"capcut_t{t:g}.png")
        ours = through_export(render(project, t, cap.width), out, f"openrip_t{t:g}")
        psnr, bad, diff = compare(cap, ours)
        print(f"t={t:g}s {what}: PSNR {psnr:.1f} dB, {bad:.2f}% of pixels differ by >64/255")
        rows.append((t, what, cap, ours, diff, psnr, bad))
    sheet = Image.new("RGB", (cell * 3, (cell + label_h) * len(rows) + label_h), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    head = ImageFont.truetype(FONT, 22)
    for i, title in enumerate(["CapCut export", "OpenRip (imported project, reference render)", "Difference (brighter = more)"]):
        d.text((i * cell + 12, 12), title, font=head, fill=(230, 230, 230))
    for r, (t, what, cap, ours, diff, psnr, bad) in enumerate(rows):
        y = label_h + r * (cell + label_h)
        for i, img in enumerate([cap, ours, diff]):
            sheet.paste(img.resize((cell, cell), Image.LANCZOS), (i * cell, y))
        d.text((12, y + cell + 10), f"t = {t:g}s | {what} | PSNR {psnr:.1f} dB | {bad:.2f}% pixels differ by >25%", font=head, fill=(200, 200, 200))
    sheet.save(out / "comparison.png")
    print(f"wrote {out / 'comparison.png'}")


if __name__ == "__main__":
    main()
