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

Session 1 settled the draft format. Session 2 measures how CapCut draws pixels, so OpenRip's compositor can match it: the resampling kernel at 100%, 50% and rotated; the internal render resolution; the colour path; and how text size scales on a 16:9 canvas.

### How it is built

The project is generated, not assembled by hand: `bench/calibration/make_draft.py` clones session 1's draft as a template and writes a new draft with the clips below. The chart `pattern.png` (1920×1080: 1-px checkerboard and line grids, a 5° slanted edge, a 256-step grey ramp, colour patches; layout in `pattern.json`) comes from `make-assets.sh`.

| Time | Clip |
|---|---|
| 0–1 s | `pattern.png` at 100% |
| 1–2 s | `pattern.png` at 50% |
| 2–3 s | `pattern.png` at 50%, rotated 45° |
| 3–4 / 4–5 / 5–6 s | default text at size 15 / 30 / 10 |

Exported from CapCut at 1080p and 4K (30 fps, H.264, bitrate Higher) as `out/openrip-calibration-2.mp4` and `out/openrip-calibration-2-4k.mp4`.

### Results — 2026-10-16 (CapCut 9.5.0)

**1. CapCut renders at the export resolution.** The 4K export of the 1080p canvas is drawn natively at 4K: the 50% clip comes out texel-for-texel (50 dB against the chart drawn 1:1), not as an upscaled 1080p frame.

**2. Resampling is two passes.** Each image is first resampled to its displayed size, then that texture is rotated and positioned:

| Stage | What CapCut does | Evidence |
|---|---|---|
| 1:1 | Passes through unchanged | 100% clip: mean error 0.14/255, zero shift, 1-px checkerboard intact |
| Downscale | Area average (2×2 box at 50%), then a 3×3 Laplacian **sharpen of strength 0.15**, clamped to 8 bits | 1-px lines every 4 px come out at 167 where a plain average gives 127.5, and the chart's mean brightness rises (the clamped negative lobes). Box alone: 31.0 dB on the 50% clip; box + sharpen: **41.4 dB** |
| Upscale | Bilinear | 4K, 100% clip: the 1-px checkerboard becomes 95/160 2×2 blocks, exactly bilinear's 0.75/0.25 weights |
| Rotate / place | Bicubic (Catmull-Rom) on the stage-1 texture | 45° clip: one-pass area filter 25.5 dB; stage 1 then Catmull-Rom **36.1 dB** (rotating CapCut's own 50% frame the same way gives 37.1 dB, the ceiling set by its encoding) |

The geometry agrees to 0.09 px at 45°.

**3. Colour path is neutral.** The grey ramp and every patch survive within ±1 code value: no tone curve, BT.709 matrix, TV range.

**4. Text size follows the canvas width, linearly.** Ink widths at sizes 10, 15 and 30 give 0.005786–0.005789 × canvas width per size unit at 1080p and 4K, the same constant session 1 found on a square canvas. Whether it is the width or the longer side is checked on a portrait canvas in session 3. Our text lands within about 1 px of CapCut's; CapCut's glyphs carry about 1.7% more ink (slightly bolder strokes or different edge smoothing), and per-glyph spacing differs by about 1 px because the reference uses Pillow's basic layout instead of HarfBuzz.

**Side-by-side, with the measured pipeline** (`bench/calibration/capcut_model.py`, full frames through the export simulation):

| Frame | 1080p | 4K |
|---|---|---|
| Pattern 100% | 54.6 dB | 48.7 dB |
| Pattern 50% | 59.7 dB | 59.7 dB |
| Pattern 50%, 45° | 42.4 dB | 43.0 dB |
| Text 15 / 30 / 10 | 34.3 / 28.0 / 36.4 dB | 34.1 / 30.4 / 33.3 dB |
| Session 1 marker (re-run) | 36.8 dB (was 35.7) | |

**The engine's GPU compositor** (`engine/crates/render`, wgpu) implements the same pipeline. Its frames match the reference model to within ±1 code value (bit-exact at 100%). Against CapCut's exports it scores the same as the model: 44.4 dB at 100%, 41.7 / 36.1 dB on the 50% / 45° regions, and 36.8 dB on session 1's marker. Its tests check CapCut's measured values directly: 1-px lines at 50% come out at ~166 (CapCut 165–168), and a checkerboard at 2× at 95/160. Video frames reach it with no copy. On session 1's 4K HEVC section (t = 5 s), the frame rendered from the hardware decoder matches CapCut's export at 32.0 dB. The neighbouring source frames score 26 dB, so timeline-to-media timing agrees with CapCut. On this moving content the remaining gap is mostly CapCut's 2.8 Mbps export encode.

**Engine text** (`engine/crates/render/src/text.rs`: swash shaping with kerning and ligatures, unhinted outlines, the draft's own font, the block of line boxes centred on the position):

| Text | Engine | Pillow reference | Notes |
|---|---|---|---|
| 16:9, size 15 | **38.1 dB** | 34.3 dB | bounding box identical to CapCut's within 1 px |
| 16:9, size 30 | **29.8 dB** | 28.0 dB | |
| 16:9, size 10 | 30.6 dB | 36.4 dB | ours 1.6 px high |
| square, size 15 | **29.8 dB** | 29.5 dB | ours 1.4 px high |

Horizontal placement is within 0.3 px everywhere; the shaping and kerning fixed Pillow's per-glyph drift. Two gaps remain:

- **Vertical:** our text sits 0.4–1.6 px higher than CapCut's. With that shift removed, the four cases match at 42.4 / 35.0 / 45.6 / 44.4 dB. The offset is 0.0023 em at sizes 15 and 30 on 16:9, but 0.0147 em at size 10 and on the square canvas. The font's hhea, typo and win metrics all give a line box of exactly 1 em, so this looks like CapCut snapping the text box to whole pixels by a rule four samples can't pin down. Session 3's portrait text adds data points.
- **Weight:** CapCut's glyphs carry about 1.8% more ink, which points to slight emboldening or gamma in its rasteriser.

**Still open: image borders.** Content edges inside an image now match, but CapCut softens the outer border of an image to about 3 px (10–90%) where our model gives 1.4 px, and its border sits about 1.6 px inside the nominal size (session 1 measured "536 of 540 px"). Session 2's chart has a black background, so its borders were invisible; session 3 tests them over grey.

## Session 3: image borders, other scale factors, opacity, portrait text

Session 3 is generated too (`make_draft.py`), as two drafts:

**`openrip-calibration-3`** (16:9, 1920×1080), `grey.png` (128 grey) on the main track for the whole 14 s, and on an overlay track:

| Time | Clip | Tests |
|---|---|---|
| 0–1 / 1–2 / 2–3 s | `pattern.png` at 25% / 37.5% / 75% | downscale filter at factors other than 2 |
| 3–4 s | `pattern.png` at 150% | upscale |
| 4–5 s | `marker.png` at 1:1 (scale 400/1080) | image border with no resampling |
| 5–6 s | `marker.png` at 1:1, rotated 30° | border under rotation only |
| 6–7 / 7–8 s | `marker.png` at 50% (1.35× upscale), 0° / 30° | border when magnified (session 1's case at native resolution) |
| 8–9 s | `marker.png` at 25% | border when minified |
| 9–10 s | `marker.png` at 1:1, offset +0.37 px right, 0.25 px down | sub-pixel placement |
| 10–11 s | `pattern.png` at 100%, opacity 50% | blending (sRGB or linear) |
| 11–12 / 12–13 s | default text, size 15, black stroke 0.06 / 0.15 (text track) | what CapCut's stroke width means; 0.06 is on 90% of real text |
| 13–14 s | default text, size 15, black background box (style 2, width/height 0.28, radius 0.4; text track) | background padding and corner radius scales (the common real setting) |

**`openrip-calibration-3-portrait`** (9:16, 1080×1920): `pattern.png` contain-fit (a 0.5625 downscale) 0–1 s, `marker.png` 1:1 at 1–2 s, then default text size 15 over black at 2–3 s (width or longer side).

### Steps (sessions 3, 4 and 5 together)

1. Install the drafts. This quits CapCut, waits for it to close, writes the drafts into CapCut's projects folder, and reopens CapCut:
   ```
   osascript -e 'quit app "CapCut"'; while pgrep -x CapCut >/dev/null; do sleep 1; done; python3 /Users/tosinkuye/openrip/bench/calibration/make_draft.py --template "$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft/1015" --register openrip-calibration-3 openrip-calibration-3-portrait openrip-calibration-4 openrip-calibration-5 openrip-calibration-5-landscape && open -a CapCut
   ```
2. In CapCut, export into `bench/calibration/out/`, all at **30 fps, H.264, bitrate Higher**:
   - `openrip-calibration-3` at **1080p**, named `openrip-calibration-3`.
   - `openrip-calibration-3` at **720p**, named `openrip-calibration-3-720p`. This shows whether CapCut renders at the export size when it is smaller than the canvas.
   - `openrip-calibration-3-portrait` at **1080p**, named `openrip-calibration-3-portrait`.
   - `openrip-calibration-4` at **1080p**, named `openrip-calibration-4`.
   - `openrip-calibration-5` at **1080p**, named `openrip-calibration-5`.
   - `openrip-calibration-5-landscape` at **1080p**, named `openrip-calibration-5-landscape`.

## Session 4: colour adjustments

CapCut stores each Adjust slider as an effect material: `type` names the slider, and `value` runs −1…1, the UI's −50…50 divided by 50. Every slider uses the same downloaded effect bundle. The formulas aren't public, so they are measured: `openrip-calibration-4` puts the chart at 100% with one slider per 1-second clip. The grey ramp gives each tone curve and the colour patches give saturation, temperature and tint.

| Time | Adjustment |
|---|---|
| 0–1 s | none (reference) |
| 1–17 s | brightness, contrast, saturation, temperature at −1, −0.5, +0.5, +1 |
| 17–29 s | tone (tint), highlight, shadow, white, black, light_sensation (exposure) at −1 and +1 |
| 29–37 s | fade, sharpen, clear (clarity), vignetting at +0.5 and +1 |

The adjustments are cloned from ones your own drafts already use, so CapCut finds their effect bundle in its cache. Nothing is copied into the repo.

## Session 5: text intros and line wrapping

Two things real drafts use that session 2's short default text never showed: library intros that reveal text character by character (85 animated clips in the local drafts: "Type 2", "Typewriter", "Type 1"), and line wrapping. What is implemented already, and why, is in [text-animations.md](text-animations.md) and [text-wrap.md](text-wrap.md); this session measures it. The animations are cloned from drafts that already use them, so CapCut finds their bundles in its cache.

**`openrip-calibration-5`** (9:16, 1080×1920), white text over black:

| Time | Clip | Tests |
|---|---|---|
| 0–3 s | "OpenRip types this line", size 11, Type 1 over 2 s | when each character appears; whether spaces count as characters |
| 3–6 s | same, Type 2 over 2 s | each character's fade start and length |
| 6–9 s | same, Typewriter over 2 s | the character rhythm and the caret (size, position, blink) |
| 9–11 s | "in the park", size 15, Typewriter over 1/3 s | the fast rhythm table, as in a real draft |
| 11 / 12 / 13 / 14 s | 13 number words, size 15: box width 600; 600 at scale 0.6; 900; 600 at size 10 | the unit of `fixed_width`, and whether wrapping scales with the clip and font size |
| 15 s | same words, auto-sized box | whether an auto box wraps (session 2 says not, in landscape) |
| 16 s | a line break, then the words, box 600 | wrapping after an explicit line break |
| 17 s | two copies of the line with a background box, box 600 | the background around wrapped lines |
| 18–20 s | Type 1 with a black stroke 0.08 | whether the stroke appears with its character |
| 20 / 21 / 22 s | "Bold" bold, "Bold" regular, "Italic" italic, size 30 | the synthetic bold's strength (`bold_width` 0.008) and the italic shear (10°; matches a cover already) |

**`openrip-calibration-5-landscape`** (16:9, 1920×1080): the words with box widths 600 and 1200, then an auto box at size 8: whether `fixed_width` is relative to the canvas width.
