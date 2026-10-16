"""Compare CapCut's exported frames with a reference render of OpenRip's imported project.

The reference render is a stand-in (Pillow), not the Rust engine: it draws each segment
straight from the imported project JSON using the model's conventions, to check that the
importer reads CapCut's draft the way CapCut renders it.

    python3 bench/calibration/compare.py <imported-project.json> <capcut-export.mp4> <out-dir>
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

CAPCUT_SIZE_UNIT_EM = 0.00584  # engine/crates/model/src/material.rs
FONT = "/Applications/CapCut.app/Contents/Resources/Font/SystemFont/en.ttf"


def capcut_frame(video, t, out_png):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", video, "-frames:v", "1", out_png], check=True)
    return Image.open(out_png).convert("RGB")


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
    frame = Image.new("RGB", (W, H), (0, 0, 0))
    t_us = int(t * 1_000_000)
    # Video/photo segments, in stacking order.
    for seg in sorted(active(project, t_us, "video"), key=lambda s: s["render_index"]):
        src = Image.open(media_path(project, seg["material"])).convert("RGBA")
        tr = seg["transform"]
        fit = min(W / src.width, H / src.height)  # scale 1 = contain-fit
        sx, sy = tr["scale"]["value"]["x"] * fit, tr["scale"]["value"]["y"] * fit
        img = src.resize((max(1, round(src.width * sx)), max(1, round(src.height * sy))), Image.BICUBIC)
        img = img.rotate(-tr["rotation"]["value"], resample=Image.BICUBIC, expand=True)  # clockwise
        cx = W / 2 + tr["position"]["value"]["x"] * W / 2
        cy = H / 2 - tr["position"]["value"]["y"] * H / 2  # +y up
        frame.paste(img, (round(cx - img.width / 2), round(cy - img.height / 2)), img)
    # Text segments.
    for seg in active(project, t_us, "text"):
        text = next(x for x in project["materials"]["texts"] if x["id"] == seg["material"])
        run = text["runs"][0]
        em = run["size"] * CAPCUT_SIZE_UNIT_EM * H
        font = ImageFont.truetype(FONT, size=round(em))
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
        cap = capcut_frame(video, t, str(out / f"capcut_t{t:g}.png"))
        ours = render(project, t, cap.width)
        ours.save(out / f"openrip_t{t:g}.png")
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
