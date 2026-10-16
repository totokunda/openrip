# Curved text

CapCut can bend a text along an arc: `text_curve` on the text material, `{"enable": true, "angle": a}`. 125 local texts carry the field but only 3 have it enabled, all in one title with a CapCut export (+57.8°, 0° and −58.5°). The typesetting is native (`arcCurveAngle` in `AMGTextTypeSetting`), so the rule below is fitted to that export.

## The rule (provisional)

- Each line is laid on a circular arc spanning `angle` degrees over the line's width: radius = width ÷ angle in radians, so the arc's length is the line's width.
- A positive angle arches the line (ends lower), a negative one sags it (ends higher).
- Each glyph's advance is centred on the arc and the glyph is turned to it.
- The arc runs through a line near the baseline for an arch (0.05 of the ascent above it) and about three quarters of the ascent up for a sag.
- The bent glyphs' bounds are centred where the straight block was.

## Fit

On the export's title (white-pixel overlap with OpenRip's render):

| | Bent text centred on the old block | Arc line | Overlap |
|---|---|---|---|
| Arch (+57.8°) | yes | baseline / 0.05 / 0.25 ascent | 0.879 / 0.896 / 0.75 |
| Sag (−58.5°) | yes | 0.5 / 0.75 / 1.0 ascent | 0.48 / 0.889 / 0.55 |
| Either | no (straight line's position kept) | best of baseline … ascent | 0.65 / 0.26 |

Radii other than width ÷ angle (×0.7 … ×1.5) all score worse. Export parity on the title's first 8 s: 18.0–29.3 dB straight → 26.9–31.8 dB curved (p10 of the whole draft 20.0 → 26.9 dB).

## Still open

- The arc line for arches and sags comes from two words in one font; a calibration draft with one word at several angles (±30°, ±90°, ±180°) and two fonts would settle it.
- Curved text with a library text style (the layered-effect renderer) is drawn straight.
