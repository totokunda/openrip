# Text styles: spacing, glow, gradient fills, outlines

CapCut's Text ▸ Basic has Character and Line spacing, a stroke, a background, a Glow, a shadow and a curve; its rich text can also paint a fill with a gradient and keep several strokes, and its Effects tab puts layered library styles on a text. This page is how CapCut stores and draws the parts OpenRip added on 2026-10-18 (spacing, glow, gradient fills, more outlines; OpenRip's own Effects styles and presets), what was checked, and what's still open. The data model and the app's library files are in [app-engine-integration.md](../plan/app-engine-integration.md) ("Text styles and captions").

## What the local drafts use

Of the local drafts' 2,019 text materials:

| | Uses |
|---|---|
| Line spacing | 0.02 on 1,930 (every new text); 0.12 on 50, all in one draft's wrapping captions (its media aren't on this machine, so no cover or export to check); 0.35, 0.07 and 0.15 on 39 materials no clip uses |
| Letter spacing | 0.05 on 3 materials no clip uses |
| Strokes | 1,808 styles with one solid stroke; none with two |
| Fill | solid on 1,993; a texture from a library style's bundle on 40; no gradient |
| Glow (`bloom`) | none |
| Inner shadows, per-style backgrounds | none |
| Library text styles | the styles the drafts attach (185 in 16 drafts; one is an SDF effect, the rest declarative) have no gradient layer. Of the 67 declarative bundles in CapCut's cache, 5 have one (a fill, three strokes, two inner shadows). |

So none of the features below changes how any local draft draws, and none can be checked against a local cover or export. [Calibration session 7](calibration.md) is the export that settles them.

## How CapCut stores them

All in the text material's rich text (`content`, a JSON string), per style (character range), except spacing:

- **Spacing:** the material's `letter_spacing` and `line_spacing`, passed to its typesetter as they are (`typeSettingParam.letterSpacing`, `.lineSpacing` in its segment script). Its panel shows the value × 20 (its QML: `baseViewModel.letterSpacing * 20`, range −10…100, no decimals), and Line 0 is 0.02 (every new text, and the panel at defaults): so Character n is n/20, Line n is 0.02 + n/20. The drafts agree: 0.05 is Character 1, 0.07 and 0.12 are Line 1 and 2. CapCut doesn't keyframe either (its keyframe types have no spacing).
- **Gradient fill:** `fill.content` with `render_type: "gradient"` and `gradient: {color: [[r, g, b], …], alpha: […], percent: […], angle, mode, style}`, the same shape as a library style's layers. Its engine has three spans (`u_gradientMode`: each character's box, each line across the text's height, the whole text) and takes the gradient's coordinate in the box's own proportions, turned by the angle about its middle. CapCut keyframes a gradient (`KFTypeTextGradientColor`, `…Angle`, `…Percent`, `…Alpha`); the importer doesn't map those keys yet (no draft has one).
- **Strokes:** `strokes`, a list; each `{width, alpha, content: {render_type, solid: {color, alpha}}}`. The panel edits the first.
- **Glow:** `bloom` in the style, `{enable, id, path}` (seen switched off in a template's rich text) and, from the names its rich-text parser reads, `colorCustomized`, `color`, `strength`, `range`, `dirX`, `dirY`, `blurDegree`. `id` and `path` name a glow bundle (the Glow section's two tiles). Its keyframes are `KFTypeBloomColor`, `Alpha`, `Strength`, `Range`, `DirX`, `DirY`. These keys are read from CapCut's engine, not a draft; session 7 writes them, and says what to do if CapCut ignores them.

## CapCut's glow

Three glow bundles are in CapCut's cache, each a `TextBloom` prefab with its shaders (read to learn the maths; nothing copied):

- **7194814374001775105**, whose settings are the panel's defaults (strength 0.3, range 0.2, X and Y 0.5): four passes.
  1. A radial blur of the text's own picture, in the text's box: from each pixel 64 samples step toward a middle at (1 − dirX, 1 − dirY) of the box, each step 1.6/64 × range^0.2 of the distance to it, the first a random fraction of a step out; weights fall by 0.9 a step. The sum is lifted (`light × sum^(1/(0.01 + light))`, light = 1.5 × strength^0.2), normalised by the weights' total and scaled by range^0.2, then put under the text at 70% of its alpha. A custom colour replaces the light's colour, by its alpha.
  2. and 3. A 9-tap blur across and down (weights 0.2 … 0.02, 1.25 px a tap at the render's size).
  4. The text on top, a quarter less saturated and 2% darker (HSV: × 0.7, then S × 0.75 and V × 1.4).
- **7367637998579487248**: eight Gaussian blurs of decreasing size, screen-blended with weights by the range, gamma-corrected; no direction.
- **7194814295517958657**: two blurs with exposure curves.

The light spreads over the whole picture: past 64 steps' reach (more than the distance to the middle at range 0.2), every pixel's line crosses the text, so a faint haze of a few levels covers the canvas.

## OpenRip

The engine draws all of it with its own code (`engine/crates/render/src/text.rs`):

| Feature | How | Checked |
|---|---|---|
| Letter and line spacing | as before: em fractions added between characters and lines (CapCut's values as they are; the app's fields × 1/20) | unit tests; the harness (Character 10 widens a text by 72 px for a 72 px em, Line 10 spreads two lines by 36 px). Not against CapCut: no draft with spacing has its media here |
| Gradient fill | per pixel: the colour at u = (x − ½)·cos θ + (½ − y)·sin θ + ½ in the box's proportions, linear between stops, ends held; box per span (character: the glyph's ink box; line: its width × the block's height; text: the block) | unit tests (spans, direction, stops); the calibration draft renders each character red to blue at 0° and bottom to top at 90°. CapCut's direction is inferred from its shader (its gradient texture's axis isn't visible there): provisional |
| More outlines | each glyph stroked at twice its width with round joins, as the first; drawn under it, the outermost at the back; in the shadow's shape too | unit tests; harness (a second 8 px outline makes the text 24 px wider at 1.5 px per unit) |
| Glow | CapCut's first style's maths above, for every style: the light at the same constants, on a coarse grid (2–4 px by the text's height, 48 of the 64 steps: the rest weigh under 0.7%), the 9-tap blur as a Gaussian of 4.6 px at 1080 (scaled with the canvas), the text dimmed on top. The image gets room for the light out to where a step weighs 5% (up to twice the block's half-size each side), and the light fades out over the outer half of that room instead of covering the canvas | unit tests (light around the text in its colour, fading out, toward the side away from its middle; the text 2% darker); harness (a green glow lights six times the text's pixels; keyframes). Not against CapCut: no draft or export with a glow |
| CapCut's library styles with gradient layers | drawn as gradients (they were drawn in their first colour) | importer test; no draft uses one |

What it costs: nothing for a text without these (the code paths are as before). A glowing text is drawn once and cached: about 33 ms for a 115 px line at 1080p, 19 ms at 720p; a gradient or outlines add little.

### OpenRip's own styles and presets

`lib/text-styles.ts` defines the Effects tab's styles as data (OpenRip's colours and sizes, nothing from CapCut's library): outlines (black, white, double, sticker, candy), glows (neon, neon pink, soft), shadows (soft, hard, retro, pop), gradients (sunset, ocean, metal, rainbow). The engine draws them as it draws CapCut's library styles, with sharp edges. `lib/text-presets.ts` has the Add-text presets (font, size, colours, a style, an In animation): the eight app styles from the shell's Text tab and ten of ours.

## Proof that other drafts didn't change

Against a build of 895005ba, on every local draft:

- `preview-scan`: all 340 saved frames (5 per draft) byte-identical;
- `cover-parity`: all 32 compared covers byte-identical, the same PSNR line for line (p50 33.8 dB, worst 9.8 dB, both from media drafts that already differed);
- `app-roundtrip`: 35 drafts compared, every one at 138.1 dB, as before.

## Not done

- **Bubbles** (Text ▸ Bubble): CapCut's are downloaded bundles (a folder with a content JSON and images its text engine frames the text with), not a simple shape; none is in the cache and no draft uses one (the 122 `text_shape` entries name a bubble with no bundle, and their covers show plain text). Left out.
- Glow styles other than the first draw like the first; the glow's haze stops short of the canvas; `blurDegree` isn't read.
- Radial and angular gradients draw linear; the text's gradient keyframes aren't mapped.
- Inner shadows, a second shadow, per-style backgrounds and texture fills on the text itself (reported in `unmapped_library`).
- A caption's word highlight on a gradient text: the gradient wins.
- Everything here is unchecked against CapCut's output until session 7 is exported.
