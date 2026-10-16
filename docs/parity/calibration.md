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

**Text size.** The default text ("Default text", CapCut's `SystemFont/en.ttf`, size 15) renders with a 65 px cap height in the 1080 px export. The font's cap height is 687/1000 em, so the em is ≈ 94.6 px: **0.00584 of the canvas per CapCut size unit.** The canvas was square, so whether this scales with width, height or the shorter side still needs a non-square check.

**Track flags (`attribute` bits).**

| Bit | Meaning | Evidence |
|---|---|---|
| 2 | hidden | certain (the middle track) |
| 1 | muted | confirmed: the top overlay (crossed-out speaker in CapCut's timeline) has attribute 1 |
| 4 | locked | confirmed: the overlay just above the main track (lock icon) has attribute 4 |

**Hidden means fully disabled.** In the 4–6 s section the three overlay tracks carry identical, in-phase audio, yet the export's audio level is exactly **1.00× one copy**. Only the locked track is audible: the hidden track is silenced as well as invisible. The model now documents `Track::hidden` this way.

**Stacking.** The draft has `render_index_track_mode_on = true` and `free_render_index_mode_on = false`. In this default mode, **layer order follows track order** (`track_render_index`), not each segment's `render_index`; the overlay segments' own values (3, 2, 1) ran opposite to their track order (1, 2, 3). The importer now uses track order unless free-layer mode is on.

**Side-by-side check.** `bench/calibration/compare.py` draws the imported OpenRip project with a reference renderer (Pillow, not the engine) and diffs it against CapCut's export: the marker differs in 0.39% of pixels (PSNR 33.4 dB) and the text in 0.34% (PSNR 27.4 dB), only along anti-aliased edges. The sheet is written to `bench/calibration/compare/comparison.png`.

**Still open:** check text-size scaling on a 16:9 canvas.
