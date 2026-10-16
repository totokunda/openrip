# Background removal (cut-outs)

CapCut's "Remove background" cuts the subject out of a clip with a model. OpenRip runs no model: CapCut saves its result in the draft, and OpenRip draws the clip through it.

## In the draft

- The video material's `matting.flag` is non-zero (3 in the local drafts) and `matting.path` names a folder in the draft: `##_draftpath_placeholder_<id>_##/matting/<hash>` (a `.zip` of it sits beside it).
- Inside, a numbered folder (`2`) holds `matting_result.json` (the source time range done), `mocf` (the frame times), and per source frame, by its time in µs:
  - `mask/<µs>`: raw 8-bit coverage, row by row, covering the **whole picture upright** (256×448 for a 9:16 clip);
  - `maskinfo/<µs>`: JSON with the mask's `width` and `height` and the subject's bounding box (not where the mask goes).

A typical use, and the first one found: the same clip twice, the copy cut out and stacked above a title, so the title reads behind the speaker's head and in front of the background.

## OpenRip

The importer keeps the folder on the media (`Media::matte`), resolved in the draft folder. For each frame the preview takes the mask of the last source frame at or before it, turns it into the stored picture's axes (phone video stored sideways), and the compositor multiplies the clip by it, stretched and bilinear, before placing it.

Paths inside the draft folder with the placeholder (stills CapCut makes, such as freeze frames) now resolve too; they were reported missing before.

## Checks

On the speaker-and-title export, the opening 4.5 s go from about 21.5 dB to 30–32 dB (`export-parity`): the title had been hidden behind an uncut copy of the clip. A second draft cuts a rotated phone clip over a freeze frame; it renders cleanly, but its export is of a different edit.
