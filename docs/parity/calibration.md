# CapCut calibration session

Some facts about CapCut's draft format can only be learned from CapCut itself. This session pins them down so `openrip-capcut` converts them exactly:

1. **Track flags.** What the track `attribute` bits mean (values seen: 0, 1, 2, 6).
2. **Transform units.** How the inspector's Position / Scale / Rotate values map to `clip.transform`, `clip.scale` and `clip.rotation` in the draft, and where they land in a rendered frame. This includes the direction of the y-axis.
3. **Text size.** How CapCut's font-size unit maps to pixels.

It takes about 5 minutes. Nothing is written to CapCut's folders by OpenRip; we only read the draft afterwards.

## Steps

0. Generate the marker image once: `bench/calibration/make-assets.sh` → `bench/calibration/marker.png` (a 400×400 red square with a white centre block and a green top-left corner).
1. In CapCut, create a new project named **`openrip-calibration`**. Set it to **16:9 (1920×1080), 30 fps**.
2. **Marker (0–2 s):** import `marker.png` and put it on the main track from 0 s to 2 s. Select it, and in the inspector set **Scale 50%**, **Position X 200, Y 100**, **Rotate 30°**. Leave everything else at its default.
3. **Text (2–4 s):** add a default text clip from 2 s to 4 s. Don't change its style, size or position.
4. **Track flags (4–6 s):** put `spikes/frame-transport/media/test-4k60-hevc.mp4` on **three separate overlay tracks**, each from 4 s to 6 s. On the first of those tracks click **mute**, on the second **hide**, and on the third **lock**.
5. Export: **1080p, 30 fps, H.264**, into `bench/calibration/out/` (create the folder).

Then tell Claude it's done. It will read the `openrip-calibration` draft and measure the exported frames at 1 s (marker) and 3 s (text).

## Results — 2026-10-16 (CapCut 9.5.0)

Note: CapCut set the canvas to **"original" 1:1, 1920×1920 at 24 fps** because the first media added was the square marker, and exported it at 1080×1080 (30 fps). The measurements below use that canvas.

**Transforms: CapCut matches the model's conventions exactly.** The importer maps them 1:1.

| Inspector value | Stored in the draft | Measured in the export |
|---|---|---|
| Position X 200 | `transform.x = 0.10417` (= 200 / 1920) | centre +55.7 px right of 540 → **0.10305 half-canvas units** |
| Position Y 100 | `transform.y = 0.05208` | centre +28.4 px **above** centre → **0.05257 half-canvas units, +y up** |
| Scale 50% | `scale = 0.5` | side ≈ 536 px of 540 expected → **scale 1 = contain-fit to the canvas** |
| Rotate 30° | `rotation = 30.0` | **30.00° clockwise** on screen |

(The sub-pixel differences come from anti-aliased edges in the centroid and area estimates.) The inspector's "X 200" is therefore 200/1920 of the canvas width as a stored value, which renders as 100 px from centre on the 1920 canvas: half-canvas units.

**Text size.** The default text ("Default text", CapCut's `SystemFont/en.ttf`, size 15) renders with a 65 px cap height in the 1080 px export. A first estimate from the font's cap height (687/1000 em) gave an em of 94.6 px. Fitting the positions of every glyph in the rendered line instead gives **93.78 px, so one CapCut size unit = 0.005789 of the canvas as an em size** (the cap-height estimate was 0.9% high because of anti-aliasing at the glyph tops). The canvas was square, so whether this scales with width, height or the shorter side is settled in session 2.

**Track flags (`attribute` bits).**

| Bit | Meaning | Evidence |
|---|---|---|
| 2 | hidden | certain (the middle track) |
| 1 | muted | confirmed: the top overlay (crossed-out speaker in CapCut's timeline) has attribute 1 |
| 4 | locked | confirmed: the overlay just above the main track (lock icon) has attribute 4 |

**Hidden means fully disabled.** In the 4–6 s section the three overlay tracks carry identical, in-phase audio, yet the export's audio level is exactly **1.00× one copy**. Only the locked track is audible: the hidden track is silenced as well as invisible. The model now documents `Track::hidden` this way.

**Stacking.** The draft has `render_index_track_mode_on = true` and `free_render_index_mode_on = false`. In this default mode, **layer order follows track order** (`track_render_index`), not each segment's `render_index`; the overlay segments' own values (3, 2, 1) ran opposite to their track order (1, 2, 3). The importer now uses track order unless free-layer mode is on.

**Side-by-side check.** `bench/calibration/compare.py` draws the imported OpenRip project with a reference renderer (exact sub-pixel affine drawing with 4×4 supersampling, not the engine), passes it through a CapCut-like export (x264, BT.709, TV range), decodes both sides the same way and diffs them:

| Frame | First pass | Now | Pixels off by > 64/255 |
|---|---|---|---|
| Marker (position, scale, rotation) | 33.4 dB | **35.7 dB** | 0.37% |
| Default text, size 15 | 27.4 dB | **29.6 dB** | 0.27% |

What is left is edges only. CapCut's image edges are **2.7 px wide** (10–90%) in its export against 1.6–1.8 px for an exact area-coverage edge put through the same encoders (x264 and VideoToolbox), so the softening comes from CapCut's renderer (its resampling or anti-aliasing), not the export. Text keeps a per-glyph residual of about ±0.7 px because the reference uses Pillow's basic layout (no HarfBuzz shaping or kerning). Session 2 measures the renderer's kernel directly. The sheet is written to `bench/calibration/compare/comparison.png`.

## Session 2: rendering kernel, colour path and text scaling

Session 1 settled the draft format. Session 2 measures how CapCut draws pixels, so OpenRip's compositor can match it:

- **Resampling kernel and internal resolution.** How CapCut filters an image at 100%, at 50% and rotated, and whether a 4K export of a 1080p canvas is rendered at 4K or upscaled.
- **Edge anti-aliasing.** The 2.7 px edge width from session 1, measured on a 5° slanted edge (ISO 12233 method).
- **Colour path.** A 256-step grey ramp and primary/secondary patches show the tone curve, matrix and range from image to export.
- **Text scaling.** Default text at sizes 10, 15 and 30 on a 16:9 canvas shows whether size follows the width, the height or the shorter side, and whether it is linear.

It takes about 10 minutes.

### Steps

0. Generate the chart: `bench/calibration/make-assets.sh` → `bench/calibration/pattern.png` (1920×1080: 1-px checkerboard and line grids, a slanted edge, a grey ramp, colour patches). Its layout is written to `pattern.json`.
1. In CapCut, create a new project named **`openrip-calibration-2`**. Set the ratio to **16:9**. Import `pattern.png` first so the canvas is 1920×1080.
2. Main track, each clip exactly **1 second** long and back to back:
   - **0–1 s:** `pattern.png`, all defaults.
   - **1–2 s:** `pattern.png`, **Scale 50%**.
   - **2–3 s:** `pattern.png`, **Scale 50%, Rotate 45°**.
3. Text, on a text track, each **1 second** long and back to back, all other style settings at default:
   - **3–4 s:** default text, size **15** (the default).
   - **4–5 s:** default text, size **30**.
   - **5–6 s:** default text, size **10**.
4. Export twice into `bench/calibration/out/`, both **30 fps, H.264, bitrate Higher** (or the highest option offered):
   - **1080p**, named `openrip-calibration-2`.
   - **4K**, named `openrip-calibration-2-4k`.

Then tell Claude it's done.
