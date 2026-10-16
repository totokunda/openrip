"""Compare CapCut's exported frames with a render of OpenRip's imported project.

The render comes from capcut_model.py, a numpy model of CapCut's pipeline as measured in
the calibration sessions (not the Rust engine yet). It draws each segment straight from the
imported project JSON, so it checks both that the importer reads CapCut's draft the way
CapCut renders it and that the measured pipeline is right.

To compare like with like, our frame goes through the same export path as CapCut's
(H.264 High, 4:2:0, BT.709, TV range), and both are decoded with identical settings.

    python3 compare.py <imported-project.json> <capcut-export.mp4> <out-dir> [t1,t2,...]

Times default to the middle of every distinct stretch of the timeline.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from capcut_model import FONT, render


def probe_size(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", video], capture_output=True, text=True, check=True).stdout
    w, h = out.strip().split(",")[:2]
    return int(w), int(h)


def decode_frame(video, t, size=None):
    """Decode one frame as full-range RGB, interpreting the stream as BT.709 TV range."""
    w, h = size or probe_size(video)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", video, "-frames:v", "1",
                          "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24",
                          "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    return Image.fromarray(np.frombuffer(raw, np.uint8).reshape(h, w, 3))


def through_export(img, workdir, name):
    """Encode like CapCut's export (H.264 High, yuv420p, BT.709, TV range) and decode back."""
    png, mp4 = workdir / f"{name}.png", workdir / f"{name}.mp4"
    img.save(png)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "2", "-i", str(png),
                    "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd,format=yuv420p",
                    "-c:v", "libx264", "-profile:v", "high", "-crf", "12",
                    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                    str(mp4)], check=True)
    return decode_frame(str(mp4), 1.0, img.size)


def default_times(project):
    cuts = sorted({b for tr in project["tracks"] for s in tr["segments"] for b in (s["target"]["start"], s["target"]["start"] + s["target"]["duration"])})
    return [(a + b) / 2 / 1e6 for a, b in zip(cuts, cuts[1:]) if b > a]


def describe(project, t):
    t_us = int(round(t * 1e6))
    parts = []
    for tr in project["tracks"]:
        for s in tr["segments"]:
            if s["target"]["start"] <= t_us < s["target"]["start"] + s["target"]["duration"]:
                x = s["transform"]
                if tr["kind"] == "text":
                    text = next(m for m in project["materials"]["texts"] if m["id"] == s["material"])
                    parts.append(f"text size {text['runs'][0]['size']:g}")
                else:
                    parts.append(f"image {x['scale']['value']['x'] * 100:g}%" + (f" rot {x['rotation']['value']:g}°" if x["rotation"]["value"] else "")
                                 + (f" opacity {s['opacity']['value'] * 100:g}%" if s["opacity"]["value"] != 1 else ""))
    return ", ".join(parts) or "empty"


def compare(a, b):
    x, y = np.asarray(a).astype(float), np.asarray(b).astype(float)
    mse = np.mean((x - y) ** 2)
    psnr = 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
    diff = np.abs(x - y).max(axis=2)
    return psnr, float((diff > 64).mean() * 100), Image.fromarray(np.clip(diff * 4, 0, 255).astype(np.uint8)).convert("RGB")


def main():
    project = json.load(open(sys.argv[1]))
    video, out = sys.argv[2], Path(sys.argv[3])
    times = [float(t) for t in sys.argv[4].split(",")] if len(sys.argv) > 4 else default_times(project)
    out.mkdir(parents=True, exist_ok=True)
    W, H = probe_size(video)
    rows = []
    for t in times:
        what = describe(project, t)
        cap = decode_frame(video, t, (W, H))
        cap.save(out / f"capcut_t{t:g}.png")
        ours = through_export(render(project, t, W, H), out, f"openrip_t{t:g}")
        psnr, bad, diff = compare(cap, ours)
        print(f"t={t:g}s {what}: PSNR {psnr:.1f} dB, {bad:.2f}% of pixels differ by >64/255")
        rows.append((t, what, cap, ours, diff, psnr, bad))
    cw = 640
    ch = round(cw * H / W)
    label_h = 44
    sheet = Image.new("RGB", (cw * 3, (ch + label_h) * len(rows) + label_h), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    head = ImageFont.truetype(FONT, 22)
    for i, title in enumerate(["CapCut export", "OpenRip (imported project, CapCut model)", "Difference (x4)"]):
        d.text((i * cw + 12, 12), title, font=head, fill=(230, 230, 230))
    for r, (t, what, cap, ours, diff, psnr, bad) in enumerate(rows):
        y = label_h + r * (ch + label_h)
        for i, img in enumerate([cap, ours, diff]):
            sheet.paste(img.resize((cw, ch), Image.LANCZOS), (i * cw, y))
        d.text((12, y + ch + 10), f"t = {t:g}s | {what} | PSNR {psnr:.1f} dB | {bad:.2f}% pixels differ by >25%", font=head, fill=(200, 200, 200))
    sheet.save(out / "comparison.png")
    print(f"wrote {out / 'comparison.png'}")


if __name__ == "__main__":
    main()
