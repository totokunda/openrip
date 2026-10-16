# Text wrapping

CapCut breaks long text lines; OpenRip didn't wrap at all until 2026-10-16, so long captions ran off both sides of portrait canvases.

## The rule (measured)

**A text box with a fixed width (`fixed_width` > 0) wraps at 0.82 of the canvas width on screen.** The following don't change it:
- the `fixed_width` value itself;
- the text's own `line_max_width` (0.78 and 0.84 occur);
- the font size;
- the clip's scale.

**An auto-sized box (`fixed_width` −1) doesn't wrap.** 0.82 is CapCut's default `line_max_width`.

Lines break greedily between words, and between any two CJK characters. A word longer than a whole line breaks between characters. Spaces at a break are dropped.

## Evidence

Every interval below is the range of screen wrap widths, as a fraction of the canvas width, that reproduces CapCut's line breaks.

**Draft covers.** `draft_cover.jpg` is CapCut's render of a draft's first frame. Seven drafts open on a long caption with no keyframes. Widths come from the font's advances: size × 0.005789 × canvas width × clip scale per em. Line widths predicted this way match the covers within about 1%.

| Draft | Size | Clip scale | `fixed_width` | `line_max_width` | Interval |
|---|---|---|---|---|---|
| A | 15 | 0.672 | 1013.6 | 0.82 | 0.728–0.942 |
| B | 16.5 | 0.705 | 816.7 | 0.82 | 0.578–0.860 |
| C | 10 | 1.097 | 605.6 | 0.78 | 0.794–0.958 |
| D | 15 | 0.731 | 814.4 | 0.82 | 0.792–1.022 |
| E | 15 | 0.762 | 657.7 | 0.82 | 0.669–0.998 |
| F | 15 | 0.862 | 667.8 | 0.82 | 0.731–1.044 |
| G | 10 | 0.921 | 629.7 | 0.84 | 0.729–0.864 |

**CapCut exports.** `openrip-dev wrap-probe <draft> <export.mp4>` sweeps the wrap width for each caption and renders it. It keeps the widths whose render matches CapCut's exported frame best. Ten local drafts have CapCut exports whose length matches the draft, for 108 captions in all. Most are single lines and only bound the width from below; none needs more than 0.855. Two wrapped captions without a text effect give 0.735–0.855 and 0.735–0.930. Captions with library text effects (a paper cut-out style) wrap differently and are left out until those effects are drawn.

**An auto-sized box.** Calibration session 2's "Default text" at size 30 is 0.99 of a 1920-wide canvas and stays on one line.

Together these give 0.794–0.855, and 0.82 fits every case. These rules don't:
- **A width proportional to `fixed_width`.** It needs incompatible factors across drafts.
- **Each text's own `line_max_width`.** C's 0.78 breaks its first line one word early; rendering C's cover at 0.78 against 0.80–0.84 confirms it.
- **A width in em.**

## Text with a library text style

Styled text (a `text_effect` attached to the clip) wraps wider. In one CapCut export, two styled captions wrap. Their first lines measure 0.839 and 0.871 of the canvas width and stay whole; adding the next word would make them 1.046 and 1.209. So the width is 0.871–1.046, above anything plain captions allow (at most 0.855). OpenRip uses 0.95 for styled text until more cases pin it.

## Still to measure

Calibration session 5's wrap clips (box widths 600 and 900, a scaled clip, size 10, landscape) should all wrap at 0.82 of the canvas width. It also shows whether a long auto box wraps on a portrait canvas.
