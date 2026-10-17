# Captions that follow the speech

CapCut's auto-captions can use a **subtitle template**: the caption shows a few words at a time and picks out the word being spoken. 43 caption clips in 6 local drafts use one. This is how CapCut draws them, read from the scripts it downloads with each template and checked against exports of the drafts.

## In the draft

- A template caption's segment points at a `text_templates` material, not at a text. The template's `text_info_resources[0]` names the text (`text_material_id`) and its `extra_material_refs`, which hold the caption style: a `material_animations` entry of type `caption`.
- The text keeps the speech-to-text words in `words`: parallel `text`, `start_time` and `end_time` arrays, in ms from the clip's start, with each space as a word of its own.
- The template bundle also lists a font and up to two library text styles ("flower"): one for the text, one for keywords. When the text's own `content` has no `effectStyle`, CapCut draws the text with its own fill and stroke and ignores them; the exports show no trace of either style.

OpenRip imports the segment as the text, with the template's attachments added.

## Caption styles

The style is a Lua script (`TextAnim.lua` on top of a shared `CaptionModule.lua`). Three appear in the local drafts:

| Resource | Uses | Pages | Spoken word | OpenRip |
|---|---|---|---|---|
| 7289356246623195649 (逐词高亮 / 逐词显色 templates) | 35 | up to 3 words | keeps its colour, yellow where it's white; other words white | ✅ `caption_word_color` |
| 7135040682032370178 (弹出 "pop") | 3 | 1 word | nothing changes; no motion either (the export switches words from one frame to the next) | ✅ `caption_one_word` |
| 7407345401457545745 (负片多行 "negative, multi-line") | 5 | lines | (not yet read) | ❌ |

## Timing

From `CaptionModule.lua`, confirmed frame by frame on the exports:

- **Holding.** A word stays the spoken word until the next one starts, across a pause of up to 1 s; a longer pause is split in the middle, and nothing is picked out in its second half. (`splitPage(0, 1)`: the pause goes all to the word before.)
- **Pages.** A page ends after three words or at the end of a sentence. It shows from its first word's start to its last word's held end. The first page shows at its exact start too; the others start just after it. Between pages that don't touch, nothing shows.
- **Spoken word.** The word whose held span contains the time; with overlapping words, the later one.
- **Clock.** The script reads the time modulo the span from the first word's start to the last word's end, so a clip that runs past its last word shows its first page again. In the local drafts that's at most a frame, except in a split caption, where it hides the end: the export shows it.

The sentence breaks don't come from the script (which only counts words) but from CapCut itself, which splits the caption before handing it over (`splitLinePage` in `libcccreator`). The exported captions only end sentences with full stops; OpenRip also ends one at `!`, `?`, `…` and the CJK stops. Commas haven't been seen.

## Edited captions

When the caption's text has been edited since it was transcribed, CapCut matches its words to the transcribed ones (`TextWordMatchUtils.matchWordInfoByText` in `libcccreator`). What the exports show:

- **Same number of words** (punctuation added, capitals or spelling changed; 41 of the 43 captions): each word takes the time of the transcribed word in its place, punctuation included. A corrected name is picked out like the misheard one.
- **A caption split in two** keeps every transcribed word in both halves: the other half's words sit at 0 ms in the second half and run past the end of the first. Words matching one transcribed word (case-sensitive, ignoring punctuation) take its time. Where a capitalised first word didn't match the lowercase transcription, it was never picked out and the page appeared only when the next word started: it's treated as unspoken, zero-length at the next word's start. OpenRip does this.

## Text size

The exports settled how CapCut's font size works for every text, not just captions: **the size sets the font's line box (ascent + descent), not its em.** CapCut's default font has a line box of exactly 1 em, which hid this until now. Measured em sizes, as a fraction of the canvas width:

| Font line box (em) | Size | Clip scale | CapCut em | 0.005789 × size × scale ÷ line box |
|---|---|---|---|---|
| 0.856 | 12 | 1.068 | 0.0865 | 0.0867 |
| 1.400 | 12 | 1.743 | 0.0865 | 0.0865 |
| 1.040 | 20 | 1.0 | 0.1111 | 0.1113 |
| 1.200 | 18 | 1.0 | 0.0947 | 0.0868 (the multi-line style; not drawn yet) |

## Shadows

A text's shadow is in its rich text's `styles[].shadows` in newer drafts, where `has_shadow` can be false (17 local texts), or in the `shadow_*` fields. Either way it's a copy of the text and its outline, moved by `distance` hundredths of the font size (a template's rich text stores a distance of 6 as an offset of 0.06), blurred by `smoothing` (`feather`) font sizes, in the shadow colour at its alpha, under the outline. On the "pop" export, a black outline of 0.078 reaches 10 px and a shadow of distance 6 at −47° moves 5 px right and 6 down (size 20, 1080 wide); OpenRip's fit gives 10 px and 5, 5. OpenRip didn't draw plain-text shadows before.

## Still open

- **The multi-line style.** It draws lines and is 9% off the size rule above, perhaps from its own line fitting (`CPage:_setMaxLineFitable`).
- **A split caption's punctuation.** In the first half of a split caption, the full stop after the last word stays white while the word is yellow, as if it were a word of its own; OpenRip picks it out with the word.
- **Vertical position.** Caption pages sat about 0.04 em higher than CapCut's; part of that was glyphs drawn up to 2 px high, fixed on 2026-10-16 (results/2026-10-16-glyph-offset.md). Measure again.
