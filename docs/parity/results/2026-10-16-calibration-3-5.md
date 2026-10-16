# Calibration sessions 3–5 — 2026-10-16 (CapCut 9.5, macOS)

Six exports (30 fps, H.264, bitrate Higher) of the generated drafts, compared with OpenRip's render of the same drafts (`openrip-dev render-frame`). Method and session contents: [calibration.md](../calibration.md).

## Text

| What | CapCut | OpenRip before | OpenRip now |
|---|---|---|---|
| Stroke reach | `width` × em (0.06 → 10.0 px, 0.15 → 25.0 px at em 166.7) | `width` × em (provisional) | confirmed; the band outside the glyph scores 31.8 / 33.0 dB |
| Background box | drawn only with `check_flag` bit 0x10 | drawn whenever `background_style` ≠ 0 | same gate as CapCut |
| Background padding | `background_width` / `height` em on each side of each line | half that, around the whole block | per line, merging lines within 2× the padding (exports: +2.3 to +3.3 dB on the caption frames) |
| Background corner | radius 0.4 → 0.22 em × clip scale | 0.4 × (0.5 em + padding) | 0.55 em × scale per unit |
| Size unit on portrait | canvas width | canvas width | confirmed (524 px both) |
| Wrap width | 0.00134 × `fixed_width` × canvas width × clip scale; the carried space counts | 0.82 of the canvas on screen; styled text 0.95 | CapCut's rule; every session-5 clip breaks like CapCut |
| Bold | each edge +1.30 px at size 30, in place | +1.31 px, glyph moved right and up by the strength | in place; bold clip 15.4 → 31.3 dB |
| Italic | 10°, about 0.268 em above the baseline | 10° about the baseline | CapCut's pivot; italic clip 9.2 → 24.9 dB |
| Type 1 / Type 2 / Typewriter | | | timings match: frame for frame, rms 0.002, every reveal frame |
| Typewriter caret | 0.065 em wide, +0.872 / −0.116 em, until the intro ends | none | none (specified in calibration.md) |

## Adjust sliders (session 4)

Chart PSNR, CapCut against OpenRip, one clip per slider value:

| Slider | −1 | −0.5 | +0.5 | +1 |
|---|---|---|---|---|
| brightness | 49.7 | 54.3 | 59.7 | 57.0 |
| contrast | 57.4 | 55.9 | 59.4 | 58.8 |
| saturation | 55.2 | 55.6 | 56.0 | 58.0 |
| temperature | 35.6 | 42.0 | 37.0 | 25.0 |
| tint | 39.1 | | | 43.1 |
| highlight | 58.5 | | | 55.0 |
| shadow | 55.4 | | | 54.7 |
| white | 58.0 | | | 61.0 |
| black | 55.9 | | | 57.8 |
| exposure | 55.1 | | | 49.0 |
| sharpen | | | 44.7 | 38.8 |
| fade | | | 18.3 | 12.4 |
| clarity | | | 37.7 | 31.8 |
| vignette | | | 19.5 | 13.8 |

The grey ramp and patches agree within ±2 code values for every implemented slider. Temperature and tint lose only on fine detail: CapCut doesn't tint 1-px detail. Fade, clarity and vignette aren't drawn; local drafts barely use them.

## Images (session 3)

| Clip | PSNR in the clip's area |
|---|---|
| marker 1:1, pixel-aligned | 65.3 dB |
| marker rotated / 50% / 25% / +0.37 px | 21.4–25.6 dB: interior 43–52 dB, edges 26–28 dB (CapCut ramps resampled edges over 2–3 px) |
| pattern 25% / 37.5% / 75% / 150% | 30.0 / 25.5 / 32.6 / 46.2 dB: smooth regions 49–66 dB, fine detail at 37.5% and 75% closer to a mip pyramid |
| pattern 100% at 50% opacity | 45.8 dB |

**720p export of the 1080p canvas.** Images match whether we render at 720p or shrink 1080p. Text matches only when rasterised at the canvas size and shrunk (37.0 against 26.1 dB).

## Effect on CapCut's exports of real drafts

Every comparable draft, every 1 s, OpenRip before against after. Samples that moved by 0.3 dB or more:
- **23 better**, by up to +5.4 dB: background boxes and wrapping on title captions, in three drafts.
- **4 worse**, all bold-italic captions in one draft (29.9 → 26.2 dB). That export was made by an older CapCut, which put the italic shear's pivot on the baseline. Today's CapCut (session 5) puts it 0.268 em above.

Median PSNR per draft is unchanged, except one draft at +1.7 dB.

## Unresolved

- **Wrapped-line centring.** Some wrapped lines are centred as if they kept their trailing space (half a space to the left), others not; no rule found ([text-wrap.md](../text-wrap.md)).
- **Text vertical offset.** Ours is 0.25–1 px higher, with no rule. CapCut's text edges are also about a 0.3–0.5 px Gaussian softer.
- **Image edges** when resampled; **minification** of fine detail at non-power-of-two factors.
- **Text resolution.** CapCut rasterises text at the canvas size, not the output size.
- **Temperature and tint** on fine detail; **fade, clarity, vignette**; the **typewriter caret**.
- **Stroke with Type 1.** A black stroke over the black background was invisible, so it couldn't be measured.
