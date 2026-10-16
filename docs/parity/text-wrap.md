# Text wrapping

CapCut breaks long text lines; OpenRip didn't wrap at all until 2026-10-16, so long captions ran off both sides of portrait canvases.

## The rule (measured)

**A text box with a fixed width (`fixed_width` > 0) wraps at 0.00134 × `fixed_width` × canvas width × the clip's scale, on screen.** The width:
- grows with `fixed_width` (a 600 box wraps at 0.804 of the canvas width, a 900 box at 1.21);
- scales with the clip, like the text, so a scaled clip breaks at the same words;
- does not depend on the font size (smaller text fits more words);
- is the same fraction of the canvas width in portrait and landscape;
- ignores the text's own `line_max_width` (0.78 and 0.84 occur).

**An auto-sized box (`fixed_width` −1) doesn't wrap**, in portrait or landscape.

Lines break greedily between words, and between any two CJK characters. CapCut fills a line character by character, and where it breaks depends on what doesn't fit:
- **A space that doesn't fit** ends the line before it, and **the next line starts with it**: it's measured with that space in front, so it has one space less room. No single width reproduces CapCut's breaks without this.
- **A word that doesn't fit** ends the line after the spaces before it, and **the line keeps them**.

The spaces count in the line's width, so a centred line with a trailing space sits half a space to the left, a line with a leading space half a space to the right, and one with both is centred as if it had neither. A background box spans them too. A word longer than a whole line breaks between characters.

Text with a library text style follows the same rule.

## Evidence

**Calibration session 5** (`make_draft.py`; size 15 unless noted, white over black). Each row lists the wrap widths, in em, that reproduce CapCut's breaks with the font's kerned advances.

| Clip | Canvas | Box | Scale | Lines | Width |
|---|---|---|---|---|---|
| 13 number words | 1080×1920 | 600 | 1 | 5 | 9.193–9.437 em |
| same | 1080×1920 | 600 | 0.6 | 5, identical breaks | same in em |
| same | 1080×1920 | 900 | 1 | 3 | 1.5× the 600 box |
| same, size 10 | 1080×1920 | 600 | 1 | 3 | 1.5× the size-15 box in em, the same in pixels |
| same | 1920×1080 | 600 | 1 | 5, identical breaks | same in em |
| two copies of a 4-word line | 1080×1920 | 600 | 1 | 3 | only with the carried space |
| same words, auto box | both | – | 1 | 1 (runs off the canvas) | no wrap |

The first line plus the next word must not fit, and every continuation line must not fit with its carried space. Together these give 0.001330–0.001366 × `fixed_width` × canvas width × scale.

**Draft covers.** `draft_cover.jpg` is CapCut's render of a draft's first frame. Seven drafts open on a long caption with no keyframes. Each interval is the range of screen wrap widths, as a fraction of the canvas width, that reproduces the cover's breaks. Every one contains 0.00134 × `fixed_width` × scale:

| Draft | Size | Clip scale | `fixed_width` | Interval | Rule |
|---|---|---|---|---|---|
| A | 15 | 0.672 | 1013.6 | 0.728–0.942 | 0.913 |
| B | 16.5 | 0.705 | 816.7 | 0.578–0.860 | 0.772 |
| C | 10 | 1.097 | 605.6 | 0.794–0.958 | 0.890 |
| D | 15 | 0.731 | 814.4 | 0.792–1.022 | 0.798 |
| E | 15 | 0.762 | 657.7 | 0.669–0.998 | 0.672 |
| F | 15 | 0.862 | 667.8 | 0.731–1.044 | 0.771 |
| G | 10 | 0.921 | 629.7 | 0.729–0.864 | 0.777 |

E bounds the constant from below at 0.001335. An earlier reading of these covers concluded "0.82 of the canvas, whatever the box and scale". That fits these seven covers, but not session 5, where box and scale clearly matter.

**A CapCut export with styled captions** (a library text style; box 775.3, scale 1, 1080 wide). It keeps lines of 0.839 and 0.871 of the canvas width whole and breaks before a word that would make 1.046, so the constant is below 0.001344. OpenRip had used a separate 0.95 for styled text; the general rule gives 1.039, inside the bound.

## Centring of wrapped lines

Which wrapped lines sit half a space to the left looked random until the break rule above: it's every line that ended at a word that didn't fit. Every case seen fits it:

| Clip | Line | Break | Centred |
|---|---|---|---|
| Session 5, 13 words, box 600, size 15 | 1 | space didn't fit | without the space |
| | 2 | starts with that space, a word didn't fit | as if without (one space each side) |
| | 3, 4 | a word didn't fit | with the space |
| same, size 10 | 1, 2 | a word didn't fit | with the space |
| Session 5, two copies of a line | 1 | space didn't fit | without |
| | 2 | starts with that space, a word didn't fit | as if without |
| A caption with a background (export) | 1 | space didn't fit | without; box without it |
| A styled caption (export) | 1 | a word didn't fit | with the space |
| A subtitle-template caption page (export) | 1 | a word didn't fit | with the space; box 0.29 em wider |

With it, session 5's wrapped clips go from 15.6–22.2 dB to 23.6–27.5 dB, the landscape clips from 12.5–13.4 to 17.4–19.8 dB, five draft covers gain 2.3–6.9 dB and none gets worse.
