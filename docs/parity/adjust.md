# Colour adjustments (CapCut's Adjust panel)

CapCut stores each Adjust slider as an effect material: `type` names the slider, `value` runs −1…1 (the UI's −50…50 / 50), and `path` points to the colour bundle CapCut downloads. In the local drafts, 45 clips use them. By clip count: brightness, highlights and temperature (43 each); sharpen (42); contrast, saturation, shadows, whites, blacks, clarity and exposure (28 each).

## Where the behaviour comes from

The colour bundle holds CapCut's own implementation, all readable:
- the Adjust shader (`AmazingFeature_adjustColor`);
- the script that turns slider values into shader parameters;
- the pipeline order (`config.json`): LUT filter → HSL → curves → colour wheels → **Adjust** → sharpen → clarity → vignette.

`openrip-render::adjust` (CPU parameters) and `adjust.wgsl` reimplement the Adjust part from that reading; nothing of CapCut's is copied into the repo. Exposure blends towards one of two 17×17×17 lookup tables that ship in the bundle. The engine reads them at run time from the bundle path the draft records, as it reads fonts from CapCut.app; without them, exposure is skipped.

Each step works on the encoded values and clamps to 0–1, in this order:

| Step | What it does |
|---|---|
| Brightness | y = 1 − (1 − x)^p. p = 1 + 5b, where b is 0.3 × slider up to 0.7 and steeper above. Below 0, p = 1/(1 − 2.5 × slider) with a 1% darkening offset. |
| Contrast | Below 0, a line through 0.435 with slope 1 + 0.4 × slider. Above 0, a sigmoid through 0.435 whose steepness grows with 1 + 0.6 × slider, corrected at the ends so 0 and 1 stay put. |
| Saturation | Mix with luma (0.2085, 0.7021, 0.0894) by 1 + slider. |
| Highlights | y = 1 − (1−x)^a − (a−1)((1−x)² − (1−x)³), a = 1 + 0.503p + 0.183p² + 0.147p³ + 0.067p⁴. |
| Shadows | y = x^a + (a−1)(x² − x³), a = 1 − 0.503p + 0.183p² − 0.147p³ + 0.067p⁴. |
| Whites / blacks | A line through moved white and black points, up to half the range. |
| Temperature / tint | Bradford adaptation from 6500 K to 6500 − 1970t + 876t² − 2630t³ K, tint 100 × slider along the isotemperature line, in BT.709 primaries. |
| Exposure | Mix towards CapCut's brighter or darker table by \|slider\|. |

**Sharpen** is a second pass after these. It adds 0.8 × slider × the strongest of four directional second differences of BT.601 luma (horizontal, vertical and the two diagonals) to every channel. CapCut's sharpness is 1.6 × slider, and its white and black gains are 0.5; the gains are stored as doubles in the bundle's material.

The primary colour wheels run before these, in the same pass:
1. **Per channel and on luma.** Each wheel maps x to ((x − lift′) / (1/gain′ − lift′))^gamma′ around the offset. The primed values come from CapCut's mappings:
   - lift halved when positive;
   - gamma 1/(1 + 4v) or 1 − 4v;
   - gain 1 + 4v² or 1 + 0.999v.
2. **Luma mix.** Luma is restored to the luma wheel's result.
3. **Saturation wheel.** It scales HSL saturation.

## Effect on parity (CapCut's exports and covers)

| Draft | Before | After |
|---|---|---|
| Export, draft with Adjust on every clip, PSNR p50 | 21.5 dB | **27.8 dB** |
| Export, draft with Adjust, HSL and curves | 16.8 dB | 20.8 dB |
| Cover, Adjust | 19.0 dB | 21.3 dB |
| Cover, Adjust, HSL and curves | 14.6 dB (95% of pixels off by > 32) | 17.3 dB (2.3%) |
| Export, draft with primary colour wheels, PSNR p50 | 22.6 dB | **31.7 dB** |

## Not yet

Not drawn yet:
- clarity, a multi-pass pyramid filter. Its sliders are at most 0.02 in the local drafts;
- vignette;
- HSL and curves. In the local drafts, every curve is empty and only 3 HSL materials change anything;
- log wheels;
- filter tracks: library LUT filters on a track of their own, applied to everything below. Two of them cover the draft still at 20.8 dB;
- fade, which no local draft uses and whose table is in a bundle-specific format.

All of them are in the same bundle.
