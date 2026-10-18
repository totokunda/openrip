# Compositing: blend modes, chroma key, canvas fills, flips

Since 2026-10-18 the engine draws CapCut's blend modes, its chroma key and its canvas fills (colour, blur, image), and mirrors sideways phone video correctly. The app's own clips get all of them as fields (`blendMode`, `chroma`, `canvas`, `flip`; [app-engine-integration.md](../plan/app-engine-integration.md), "Colour and compositing"), and CapCut drafts' are imported.

No local draft uses a blend mode or a chroma key, and every canvas they have is CapCut's default (black), so there is no export to compare against. The blend modes and the chroma key ship with CapCut as readable bundles, and OpenRip reimplements them from reading those; the checks below compare the GPU against the bundles' own formulas worked off the page. The canvas blur's strength is provisional: CapCut draws it natively, not from a readable bundle.

## What the drafts use

Surveyed over all 68 local drafts (`draft_info.json`):

| Feature | Draft field | Use |
|---|---|---|
| Blend modes | `materials.effects`, `type: "mix_mode"` | 0 |
| Chroma key | `materials.chromas` | 0 |
| Canvas fills | `materials.canvases` (one per video segment) | 909, every one `canvas_color` with `color: ""` (black) |
| Flip | `clip.flip` | 1 (horizontal), on a hidden track |

## Blend modes

CapCut's Blend › Mode menu lists eleven: Default, Color dodge, Linear burn, Hard light, Multiply, Color burn, Overlay, Brighten, Darken, Soft light, Screen. Default is plain "over"; each of the other ten is a bundle that ships inside CapCut (`Resources/MixMode`, listed in `MixMode.json` by name, effect id and resource id), drawn on the clip with the composite below it as `baseTex`.

| Mode (CapCut's name) | Resource id | B(b, s): backdrop b, layer s, straight colours |
|---|---|---|
| Darken | 6758324839670354445 | min(b, s) |
| Brighten | 6758324919789949453 | max(b, s) |
| Multiply | 6758325895519277582 | b·s |
| Screen | 6758325170760323597 | b + s − b·s |
| Overlay | 6758324989931295240 | 2bs if b < ½, else 1 − 2(1 − b)(1 − s) |
| Hard light | 6758325264670790152 | Overlay with b and s swapped (the branch by the layer) |
| Soft light | 6758325439212556814 | 2bs + b²(1 − 2s) up to s = ½, else √b(2s − 1) + 2b(1 − s) |
| Linear burn | 6758325619253056013 | max(b + s − 1, 0) |
| Color burn | 6758325724848853518 | 1 − min(1, (1 − b)/s); s = 0 gives 0, or 1 over white |
| Color dodge | 6758325800031752712 | min(1, b/(1 − s)); s = 1 gives 1 |

Each bundle puts the clip, its opacity applied, over what's below by source-over with the blend inside the overlap: colour = s(1 − αb) + b(1 − αs) + αs·αb·B, alpha = αs + αb − αs·αb (its premultiplied branch; over an opaque canvas its straight branch is the same). The ends of Color burn and Color dodge are the premultiplied branch's. Soft light is Photoshop's (√b above the middle), not the W3C one. libcccreator has a different, generic blend shader (26 modes, its Hard light the same as its Overlay); the drafts name the bundles, so those are what OpenRip follows.

**How it's drawn** (`openrip-render`, `blend.rs` and `blend.wgsl`): a layer with a blend mode copies the canvas below it (the frame's canvas, or a transition's group), then is placed (Catmull-Rom, as every layer) and blended over the copy in one pass, written as it is where the layer reaches. A layer without one draws exactly as before. The mode is an effect the segment attaches (`EffectCategory::Blend`, `builtin` the mode's name), as CapCut attaches its `mix_mode` effect; it applies to videos, photos, texts and stickers.

**Import:** a `mix_mode` effect by its resource id, effect id or menu name (English or Chinese); an unknown one is drawn as Default and listed in the import report's `unmapped_library`.

## Chroma key

CapCut's Remove BG › Chroma key is the `Chroma2` bundle that ships with it (`Resources/Chroma2`, three passes; its Lua script maps the panel's sliders onto the shader, 0–1). OpenRip's `chroma.wgsl` reimplements the three passes on the clip's own pixels, before its LUT and colour grade:

1. **The matte.** In BT.601 YUV, how far the pixel's colour difference is from the key's and from a second point further out along the key's hue (the further with more intensity), scaled by a width that narrows for bright keys; plus a luma term for grey keys and a hue term for saturated ones. Shadow keeps pixels whose point in the HSV cone lies far from a point above it (the key's darker shades, shadows cast on the screen), more of them with more shadow.
2. **Edge smoothing across**, then **down**: the matte averaged over a span of 1.4% of the picture's shorter side at full smoothing (with the span's largest and smallest values), stretched about a threshold that rises with the smoothing, kept between those bounds.
3. **Spill**: the colour's hue turned so the key sits on green, the key's colour taken out of it in proportion to how green it is, its green pulled down towards its red and blue, its colour difference reduced, and turned back. The picture is multiplied by the matte.

The draft's `chromas` material: `color` (`#RRGGBB` or `#RRGGBBAA`), `intensity_value`, `shadow_value`, `edge_smooth_value`, `spill_value` (names from CapCut's `MaterialChroma` accessors; 0–1). CapCut keyframes all four (`KFTypeChromaIntensity`, `…Shadow`, `…EdgeSmooth`, `…Spill`); the importer maps them onto the key (`Param::ChromaIntensity` and so on). At intensity 0 the key is off, as in the bundle.

CapCut runs the effect on the clip's input texture; OpenRip on the clip's picture at its displayed size. The edge smoothing's span is a fraction of the picture, so it covers the same part of the picture either way; only its sampling differs.

## Canvas fills

CapCut's Canvas (None, Blur, Color, Pattern; "Apply to all") is a material on every video segment, drawn for the main track's clip only. OpenRip does the same: the main track is the lowest video track, and while its clip is shown its fill is the canvas under everything.

- **Color:** the frame's background colour. CapCut's default `""` is black, which draws nothing new.
- **Blur:** the clip's own picture (upright, untransformed) covering the canvas, blurred by two rounds of the transition blur's 17-tap pass, each with half the variance, to a standard deviation of `blur` × 0.1 of the canvas's shorter side. CapCut's four levels are 0.0625, 0.375, 0.75 and 1. **Provisional:** CapCut's canvas filter is native (VESDK's `VideoCanvasFilter`, a blur level and a radius mode), not a readable bundle, and no draft or export has one; 0.1 is judged from the panel's previews of the four levels.
- **Image (Pattern):** the image covering the canvas.

Transitions that mix two main-track clips draw each into a group of its own; each group now starts from that clip's fill (its colour, or black under its blur or image) instead of black.

## Flips

`clip.flip` was already imported onto the transform. Phone video is stored on its side and shown upright by a quarter turn; a mirror on screen's x was mapped to the texture's u, which on its side is screen's y, so a horizontal mirror drew it upside down. The flips now follow the texture's axes. The draft with a flip has it on a hidden track (the frames are the same with it off), so no draft changes.

## LUTs on a clip

A filter attached to a video or photo (CapCut's Adjust › LUT, the app's `color.lut`) is drawn on the clip's own pixels after the chroma key and before HSL, curves, wheels and the sliders, CapCut's order. It can be a `.cube` file (`LUT_3D_SIZE`, entries at the cube's corners), a Hald CLUT image, or CapCut's table in its bundle; its strength is keyframeable. Before, only filter tracks were drawn. No local draft has a filter on a clip.

## Checks

| Check | Result |
|---|---|
| Each blend mode on the GPU against its bundle's formula worked on the CPU (`blend.rs`), every pair of 16 levels, a layer at 78% alpha and 75% opacity | within 1 code value (2 for Color burn and dodge) |
| Each blend function at hand-worked points; opacity and alpha as source-over | unit tests (`render/src/blend.rs`) |
| The chroma matte against a line-by-line transcription of the bundle's shader (kept out of the repo), 221 colours × intensity 0.3, 0.6, 0.9 and shadow 0.7 | mean difference 0.0001, worst 0.002 (the 8-bit readback) |
| The spill pass against the same transcription, 220 colours × three settings | within 1 code value |
| The chroma key in frames: a green screen keyed out, a red square kept, intensity 0 changes nothing, a smoothed edge, spill on a greenish grey (`render/tests/compositing.rs`); keyed intensity (`playback/tests/compositing.rs`) | pass |
| Canvas fills in frames: colour around a main-track clip, black and other tracks' fills draw nothing, blur, image, each clip's fill in a Mix (`playback/tests/compositing.rs`) | pass |
| Flips, sideways too; `.cube` parsing and a LUT on a clip by strength | pass |
| In the app: the harness step `compositing` (canvas colour, blur and image; Darken and Screen against it; the mirror; exposure, HSL, a `.cube` LUT; a chroma key and its keyframed intensity; the saved project) | 15 of 15 |

**Drafts that don't use these features are unchanged** (before is 76feb983, built separately):

| | Before | After |
|---|---|---|
| preview-scan, 5 frames of each of 68 drafts | 340 frames | byte for byte the same |
| cover-parity, 32 drafts with their first frame's media | p50 33.8 dB, worst 9.8 dB | the same, draft for draft |
| export-parity, the 6 drafts with a CapCut export (every 2 s, 167 samples) | p50 18.0, 11.4, 36.3, 33.1, 24.8, 37.9 dB | the same, sample for sample |
| app round trip, 35 drafts with their media | 138.1 dB | 138.1 dB |

**Cost:** nothing when unused (playthrough of two drafts at 540p, three alternating runs each: p50 3.7–4.4 ms either build). Used, on a 1080×1920 frame of two layers with readback: a blend mode +0.4 ms (one canvas copy), the chroma key +0.4 ms (three passes on the clip), a LUT on the clip under 0.1 ms, a canvas blur +3 ms (the clip drawn again and four blur passes).

## Still open

- **Measured parity.** A calibration draft with each blend mode over a gradient, chroma keys at a few settings on a green-screen clip, the four canvas blur levels, a colour and a pattern, exported once from CapCut, would measure all of this against CapCut's own output; the blur's strength is the one number that's a guess.
- A pattern is drawn from the path the draft records (CapCut's cache, for its library's patterns); when that file isn't on the machine, the canvas is black.
- Blend modes on adjustment layers and effect bars (not drawn yet).
