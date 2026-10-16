"""Generate the renderer calibration chart (1920x1080).

Regions, chosen so each one isolates one part of CapCut's rendering pipeline:
- 1-px checkerboard and 1-px line grids: resampling kernel / internal render resolution
- 5-degree slanted-edge square: edge spread function (ISO 12233-style sharpness)
- grey ramp (256 steps): tone curve and quantisation through the export path
- colour patches (R, G, B, C, M, Y, white, greys, black): colour matrix and range
Layout is written to pattern.json so analysis code knows where each region is.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

W, H = 1920, 1080
out = Path(__file__).parent
img = np.zeros((H, W, 3), np.uint8)
layout = {}

# 1-px checkerboard, 240x240
y0, x0 = 60, 60
yy, xx = np.mgrid[0:240, 0:240]
img[y0:y0 + 240, x0:x0 + 240] = (((yy + xx) % 2) * 255)[..., None]
layout["checker_1px"] = [x0, y0, 240, 240]

# 1-px vertical and horizontal lines every 4 px, 240x240 each
x0 = 360
block = np.zeros((240, 240), np.uint8)
block[:, ::4] = 255
img[y0:y0 + 240, x0:x0 + 240] = block[..., None]
layout["vlines_4px"] = [x0, y0, 240, 240]
x0 = 660
img[y0:y0 + 240, x0:x0 + 240] = block.T[..., None]
layout["hlines_4px"] = [x0, y0, 240, 240]

# Slanted-edge square (white on black), 5 degrees, centred in a 360x360 region.
# Drawn at 8x and box-downsampled so the edge is an exact area-coverage ramp.
c, r, t = 180, 110, np.radians(5)
corners = [(c + r * (np.cos(t) * sx - np.sin(t) * sy), c + r * (np.sin(t) * sx + np.cos(t) * sy)) for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
big = Image.new("L", (360 * 8, 360 * 8), 0)
ImageDraw.Draw(big).polygon([(x * 8, y * 8) for x, y in corners], fill=255)
edge = np.asarray(big, np.float64).reshape(360, 8, 360, 8).mean(axis=(1, 3))
x0 = 960
img[y0:y0 + 360, x0:x0 + 360] = np.round(edge).astype(np.uint8)[..., None]
layout["slanted_edge"] = [x0, y0, 360, 360]

# Grey ramp: 256 steps, 6 px each, 80 px tall
y1 = 460
ramp = np.repeat(np.arange(256, dtype=np.uint8), 6)
img[y1:y1 + 80, 60:60 + ramp.size] = ramp[None, :, None]
layout["grey_ramp_6px_steps"] = [60, y1, int(ramp.size), 80]

# Colour patches, 140x140 each
patches = {
    "red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255),
    "cyan": (0, 255, 255), "magenta": (255, 0, 255), "yellow": (255, 255, 0),
    "white": (255, 255, 255), "grey75": (191, 191, 191), "grey50": (128, 128, 128),
    "grey18": (46, 46, 46), "black": (0, 0, 0),
}
y2 = 600
for i, (name, rgb) in enumerate(patches.items()):
    x = 60 + i * 160
    img[y2:y2 + 140, x:x + 140] = rgb
    layout[f"patch_{name}"] = [x, y2, 140, 140]

Image.fromarray(img).save(out / "pattern.png")
# Flat backgrounds for border and blending tests
Image.new("RGB", (W, H), (128, 128, 128)).save(out / "grey.png")
Image.new("RGB", (64, 64), (0, 0, 0)).save(out / "black.png")
(out / "pattern.json").write_text(json.dumps(layout, indent=1))
print(f"wrote {out / 'pattern.png'} and pattern.json ({len(layout)} regions), grey.png, black.png")
