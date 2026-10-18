# The rest of CapCut's colour bundle: HSL, curves, clarity, vignette and fade

[adjust.md](adjust.md) covers the Adjust sliders and primary wheels. This page covers the other parts of the same colour bundle (`7501974767453474064`) that drafts use. Everything below was read from the bundle's shaders, Lua scripts and binary scene files (decoded with `bench/capcut/amg_decode.py`) and reimplemented; nothing of CapCut's is copied into the repo. The fade table is read at run time from the bundle path the draft records.

## Where each one runs

The bundle's `config.json` orders its features. A clip's colour grade runs in that order, each step only when the clip uses it:

0. **A LUT on the clip** (since 2026-10-18; [compositing.md](compositing.md)), after its chroma key if it has one.
1. **HSL and curves:** one pass, `fs_colour` in `render/src/grade.wgsl`.
2. **Primary wheels and the Adjust sliders:** the Adjust pass. Fade is part of it, between temperature/tint and exposure, as in CapCut's shader.
3. **Sharpen.**
4. **Clarity, then the vignette:** `render/src/finish.wgsl`.

A clip that uses none of them is drawn as before; the passes cost nothing when unused. `playback/src/colour.rs` turns the draft's materials into the compositor's parameters.

## HSL

One `hsl` material per colour range. `hsl_color_type` 1–8 are CapCut's named ranges: red, orange, yellow, green, cyan, blue, purple and magenta. 9 is a colour picked with the eyedropper (`custom_color`); a clip can have up to ten. `hue`, `saturation` and `lightness` are the sliders, −100…100.

- **Ranges:** each range has four hues: outer left, inner left, inner right, outer right. Between the inner hues a pixel takes the whole shift; towards the outer ones it fades to none. Shifts of overlapping ranges add up.
  - The named ranges' hues are fixed in the shader, and so is a per-range scale of each slider. Red's hue slider counts ¼, for example, and lightness counts 1/2.7 in most ranges.
  - A picked colour's range comes from two tables in the script: how far left and right of its hue the range reaches, by hue. The inner hues are the middle 30% of that. A picked colour's hue slider counts 0.3 and its lightness 0.37.
- **The shift:**
  - Hue turns by the summed shift.
  - Saturation is scaled: by 1 + s below zero, by 1 + s/2 above.
  - Lightness moves by the saturation the pixel has, times (1 − l) when darkening and (1.15 − l) when lightening. When lightening, the move is also scaled by what's left after the saturation step.

## Curves

`color_curves` has a list of anchors with bezier handles for each of luma, red, green and blue. CapCut draws each curve into a 1024-entry table and reads the table without filtering.

- Between anchors, the curve is a cubic bezier through each anchor's right handle and the next anchor's left handle, solved for x by bisection. Before the first anchor and after the last, it continues along the line through the end anchor and its handle.
- Each colour channel goes through its own curve. Then every channel moves by the difference between the luma curve's output for the original's luma and the luma after the colour curves. The result's luma is therefore the luma curve's, so a red curve alone keeps luma and shifts hue.
- The draft has no strength for the curves; the bundle's material default is 1 for each channel.

## Clarity

Clarity is a Laplacian pyramid on the HSV value, eight levels deep (fewer for pictures under 128 pixels). Each level is half the size of the one above it, made by drawing that level bilinearly.

1. **Detail bands:** each band is a level minus the next level up-sampled. A band d becomes d + 0.55·d·exp(−d²/(2·0.15²)), so small detail grows by up to 55%.
2. **Rebuild:** starting from the smallest level, each band is added to the level below it, kept within 0–1.
3. **Final mix:** the rebuilt value replaces the value of the picture with its HSV saturation raised by 1.12. That picture is mixed over the original by the slider.

CapCut keeps the pyramid in 8-bit render targets, with each float spread over three bytes. OpenRip keeps it in floats.

## Vignette

The vignette works over the clip's own picture, by the distance d from its middle in half-sizes (√2 at the corners). The slider value v is eased through one of two cubic beziers into a parameter p.

- **v > 0:** the picture mixes towards black by smoothstep(mix(1, 0.1, |p|)·√2, mix(1.4, 0.85, |p|)·√2, d).
- **v < 0:** the picture mixes towards white by smoothstep(mix(1, 0.2, |v|)·√2, mix(1.5, 0.9, |p|)·√2, d).

## Fade

Fade mixes towards a 17³ lookup table by the slider, read like the exposure tables. The table is a 289×17 PNG embedded in the bundle's `AmazingFeature_adjustColor/image/fade_max.texture`, an AmazingEngine texture file. If it isn't there, fade is left out.

## Parity

Before is OpenRip at fbaf69e8; after is with these passes. Drafts are lettered.

| Feature | Reference | Before | After |
|---|---|---|---|
| Curves (luma 0→0.018, 1→0.920) on all 40 clips of draft C | CapCut's export, every 4 s, PSNR p50 | 26.8 dB | **31.0 dB** (every sample up 3–5 dB except two with a text style) |
| | its cover | 22.4 dB | 23.1 dB (the cover's frame has motion) |
| HSL: three picked colours (one at +100 saturation and lightness) on draft D's first clip | its cover | 31.3 dB | **36.0 dB** |
| Fade 0.5 / 1 | calibration session 4 export | 18.1 / 12.2 dB | **51.3 / 52.9 dB** |
| Clarity 0.5 / 1 | same | 39.4 / 34.0 dB | **47.1 / 46.8 dB** |
| Vignette 0.5 / 1 | same | 23.9 / 17.3 dB | **48.2 / 50.5 dB** |
| Clarity 0.02 on every clip of draft E | CapCut's export, every 2 s | p50 30.6 dB | 30.6 dB (no sample changed by 0.1 dB) |
| | its cover | 30.6 dB | 30.5 dB |

The unadjusted reference clip of the calibration export scores 47.2 dB, so fade, clarity and the vignette are now as close to CapCut as plain video is. Draft D's export was made from an earlier version of the draft (different framing), so only its cover compares.

The app round trip still matches exactly (138.1 dB) on all 58 drafts whose media could be found, including those on the external disk. Cover parity over all 56 drafts with a cover changed only C, D and E.

## The app

These are marked drawn in the Adjust tab (`draftAdjustments`):
- clarity, vignette and fade are sliders on CapCut's 0…100;
- each HSL range has hue, saturation and lightness sliders on −100…100;
- curves are listed and can be taken off, but not set (CapCut edits them on a curve).

An edit goes on a copy of the draft's material for that clip, as for the other sliders.

## The app's own clips

Since 2026-10-18 the app's own videos and photos have the same tools, drawn through the same passes: `color` on the clip (ClipColor in lib/types.ts) holds CapCut's Basic sliders on CapCut's scale, the eight HSL ranges, curves as points, the primary wheels and a LUT, and the importer (`engine/crates/v1/src/color.rs`) turns them into the materials a draft would have:

- **Sliders:** one Adjust effect each, the value divided by CapCut's scale (50, or 100 for sharpen, clarity, vignette and fade) as the draft keeps it. Exposure and fade read their tables from a colour bundle: a draft's own, else the one that ships with CapCut (`Resources/DefaultAdjustBundle/merge_all_adjust_color`, the same three files byte for byte as the downloaded bundle). Without CapCut installed they're left out, as for a draft whose bundle is missing.
- **HSL:** one material per range set (`hsl_color_type` 1–8).
- **Curves:** the app keeps points; the handles are CapCut's. Read off the drafts' curves: each inner point's handles lie along the line between its neighbours, a sixth of it either way; an end's handle is halfway to its neighbour's near handle; two points alone make a straight line (handles a third of the way). `v1/src/color.rs` reproduces a draft's three-point red curve and two-point luma curve to 1e-9.
- **Wheels:** CapCut's values and strength, as the draft keeps them. Log wheels aren't drawn yet, for drafts or the app.
- **LUT:** a `.cube` file or a Hald image, a filter on the clip, drawn first ([compositing.md](compositing.md)).

All but curves are keyframeable (`adjust:<slider>`, `hsl:<range>:<part>`, `wheels:intensity`, `lut:intensity`), as CapCut keyframes them. Checked by the v1 crate's tests (fields to materials, keys, a converted clip) and the harness step `compositing`: exposure +40 lightens the standard clip from 0.507 to 0.684, saturation −100 on every range greys it, an inverting `.cube` inverts it.

### The old sliders

The app's first sliders (brightness, contrast, hue, saturation, blur, sharpness, noise, vignette on its own scales, the engine's `v1:` effects) still draw as its WebGL filters drew them, so old projects look the same. New edits go in `color`. `migrateLegacyAdjustments` (lib/color.ts) moves the ones with a counterpart onto CapCut's set at the value whose picture comes closest, measured on the engine over a ramp of greys and hues (least squares, the draft's value in 0.01 steps):

| Old slider | CapCut's (draft value) | rms difference left |
|---|---|---|
| contrast −25 / 25 / 50 / 100 | contrast −0.72 / 0.49 / 0.76 / 0.97 | 2.7 / 6.0 / 8.2 / 9.9 levels |
| saturation −50 / 50 / 100 | saturation −0.38 / 0.39 / 0.55 | 9.0 / 9.0 / 11.5 |
| vignette 25 / 50 / 100 | vignette 0.15 / 0.37 / 0.67 | 6.1 / 4.9 / 3.3 |
| sharpness 25 / 50 / 100 | sharpen 0.25 / 0.56 / 1.0 | 3.0 / 5.9 / 11.7 |

Brightness has none (an offset: +25 is still 25 levels off at CapCut's strongest brightness), nor do hue, blur and noise; they stay as they are, as do keyframed sliders. In the app, contrast 25 moved this way changes the clip's mean lightness from 0.508 to 0.535.

## Not drawn

- **Log wheels:** no local draft uses them.
- **color_match and color_correct:** used by one draft. These are CapCut's automatic colour matching and correction, run by its colour-analysis models (`preRenderAlgorithmTex`, `lens_ii_auto_color_map`). OpenRip has no such models.
- **particle:** used once, at 0. It does nothing at 0.
