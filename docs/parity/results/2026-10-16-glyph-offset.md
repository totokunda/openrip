# Glyph placement fix (2026-10-16)

Each glyph is rasterised at its pen position's whole pixel plus the sub-pixel rest, passed to swash as an offset. Swash's offset is y-up, so the vertical rest moved glyphs up instead of down: every glyph sat `2 × fract(y)` pixels high (0–2 px, 1 px on average). Probed on a 100 px Arial "H": the bottom edge now lands within 0.02 px of the baseline at four sub-pixel positions. The horizontal rest was already right.

The fix moves all text, CapCut's included. Same binaries before and after, CapCut 9.5.0 references:

**Draft covers** (`cover-parity`, 31 drafts with media): 8 covers improve (+0.2 to +2.1 dB; pixels off by > 32 down by up to 0.35 points), none get worse.

**Exports** (`export-parity --every 1`, the 12 drafts with a CapCut export; 2 have media missing and 2 are exports of a different edit):

| Export | p50 before → after | p10 | worst |
|---|---|---|---|
| 2 | 33.7 → 33.8 | 24.1 → 24.1 | 22.2 → 22.2 |
| 5 | 30.8 → 33.0 | 25.7 → 25.8 | 22.1 → 22.7 |
| 6 | 31.8 → 32.0 | 30.0 → 30.9 | 29.0 → 29.0 |
| 7 | 28.5 → 28.8 | 26.5 → 27.2 | 22.0 → 22.3 |
| 9 | 27.7 → 27.9 | 25.4 → 26.5 | 23.6 → 25.4 |
| 10 | 30.7 → 30.7 | 28.7 → 28.7 | 23.5 → 24.2 |
| 11 | 24.9 → 24.8 | 22.1 → 22.1 | 18.5 → 18.5 |
| 12 | 32.7 → 36.8 | 24.1 → 24.5 | 20.1 → 20.1 |

The caption pages that sat about 0.04 em high (captions.md) moved down by up to 2 px; that offset needs measuring again.
