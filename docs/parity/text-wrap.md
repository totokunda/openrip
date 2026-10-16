# Text wrapping

CapCut breaks long text lines inside the text box. OpenRip didn't wrap at all until 2026-10-16, so long captions ran off both sides of a portrait canvas.

## What CapCut does (measured)

Each draft folder holds `draft_cover.jpg`, CapCut's own render of the first frame. Seven local drafts open on a long caption with no keyframes. For each one, the table compares the caption's first line as CapCut broke it with the same line plus the next word. Widths are on screen, from the font's advances: size × 0.005789 × canvas width × clip scale per em. Line widths predicted this way match the covers within about 1%.

| Draft | Size | Clip scale | `fixed_width` | `line_max_width` | First line (px) | Plus next word (px) |
|---|---|---|---|---|---|---|
| A | 15 | 0.672 | 1013.6 | 0.82 | 786 | 1017 |
| B | 16.5 | 0.705 | 816.7 | 0.82 | 624 | 929 |
| C | 10 | 1.097 | 605.6 | 0.78 | 858 | 1035 |
| D | 15 | 0.731 | 814.4 | 0.82 | 855 | 1104 |
| E | 15 | 0.762 | 657.7 | 0.82 | 722 | 1078 |
| F | 15 | 0.862 | 667.8 | 0.82 | 789 | 1128 |
| G | 10 | 0.921 | 629.7 | 0.84 | 787 | 933 |

Calibration session 2 adds a counter-case. "Default text" at size 30 on a 1920-wide canvas is 1,904 px wide in an auto-sized box (`fixed_width` −1), and CapCut kept it on one line.

What the data rules out:
- **A fixed em width.** No single width in em fits all seven.
- **`line_max_width` × canvas width.** C's own 0.78 would break its first line.
- **`fixed_width` in canvas pixels.** It would wrap every caption much earlier.

What fits all seven:
- **The rule implemented.** The wrap width is `fixed_width` × k × clip scale with k between 1.441 and 1.493 on a 1080-wide canvas. That reads as `fixed_width` in units of about 1/736 of the canvas width. 1/720 would be the natural guess, but A's cover rules it out by 0.4%, which is about the error of these width estimates.
- **The alternative.** A constant 0.82 of the canvas width fits too, but only by ignoring each text's own `line_max_width`.

An auto-sized box doesn't wrap.

## What OpenRip does

- **Import.** The CapCut importer sets `TextLayout::max_width` to `fixed_width / 736` of the canvas width, or to no limit for an auto-sized box. The preview scales it with the clip.
- **Breaking.** Lines break greedily between words, and between any two CJK characters. A word longer than a whole line breaks between characters. Spaces at a break are dropped.

## Still to measure

Calibration session 5 settles the remaining questions:
- the unit of `fixed_width`;
- whether wrapping scales with the clip and font size;
- whether `fixed_width` is relative to the canvas width (the landscape draft);
- whether an auto box ever wraps.
