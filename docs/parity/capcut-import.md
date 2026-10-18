# CapCut project import — coverage

Importer: `engine/crates/capcut` (`openrip-capcut`). Try it:

```bash
cd engine
cargo run --release -p openrip-dev -- capcut-scan "$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft"
cargo run --release -p openrip-dev -- capcut-import "<one draft folder>" --out /tmp/project.json
```

The importer only reads CapCut's files; it never writes to CapCut's data folder.

## 2026-10-15 scan (56 real drafts, CapCut format versions 164–187)

| | |
|---|---|
| Drafts imported | **56 / 56** |
| Tracks / segments | 354 / 3,017 (video 835, text 1,983, audio 191, sticker 4, filter 3, effect 1) |
| Structural problems (dangling refs, overlaps, bad durations) | 0 |
| JSON round-trip losses | 0 |
| Import time | 3.4 ms average, 13.4 ms max per draft |
| Media files missing on this machine | 740 of 1,026 (→ relink is a P0 feature) |

**Mapped to OpenRip types:** videos, photos, audios, texts (rich runs, strokes, shadow, background, spacing, gradient fills and glow: [text-styles.md](text-styles.md)), speeds, canvas fills, audio fades, transitions, Adjust sliders (brightness, contrast, saturation, sharpen, highlights, shadows, temperature, tint, vignette, blacks, whites, exposure, fade, clarity), **HSL (8 named ranges plus custom colour, −100…100), tone curves (bezier anchors per luma/R/G/B channel), primary and log colour wheels (lift/gamma/gain/offset)**, filters/effects, and keyframes: the transform, opacity, volume, the Adjust sliders, filter strength, colour wheels, HSL, a text's style and glow, and a mask's geometry, with CapCut's curves ([keyframes.md](keyframes.md)).

**Kept verbatim, not interpreted yet** (ordered by how much real projects use them):

| CapCut table | Uses | Next step |
|---|---|---|
| `material_animations` | 2,731 | Clip/text In/Out/Combo animations. These are CapCut library presets: the typing intros, caption styles and Fade In / Fade Out map to built-ins ([text-animations.md](text-animations.md), [clip-animations.md](clip-animations.md)); the rest keep their library reference and are listed in the report's `unmapped_library`. |
| `sound_channel_mappings` | 1,026 | Channel routing (mono/stereo); likely trivial. |
| `placeholder_infos` | 1,026 | Per-media placeholder metadata; probably ignorable. |
| `vocal_separations` | 1,026 | AI feature; unsupported by design (usually inactive entries). |
| `material_colors` | 835 | Investigate. |
| `loudnesses` | 313 | Loudness normalisation; implement in `openrip-audio`. |
| `beats` | 191 | Beat markers; P2 DSP feature. |
| `text_templates` | 43 | Library text templates: placeholder plus base text. |
| `realtime_denoises`, `smart_crops`, `vocal_beautifys` | 29 / 10 / 5 | AI features; unsupported by design. |
| `stickers`, `time_marks`, `drafts` | 4 / 4 / 2 | Map as their features land. `audio_effects` (voice effects) and `common_mask` (video masks, [masks.md](masks.md)) are mapped now. |

**Library items** (CapCut-only assets we can't ship; need built-in equivalents or placeholders): text effects 185, text shapes 122, animations 2,731, text templates 43, transitions 8, stickers 4, filters 3, a few video effects.

**Speed and pitch:** CapCut keeps the pitch when a clip's speed changes, unless the segment's `is_tone_modify` ("change pitch") is on. All 21 speed-changed clips in the local drafts keep it. The importer maps this to `Segment::change_pitch`.

**Text backgrounds:** CapCut keeps a colour and alpha (black, 1.0) on every text, even with the background off. Only `background_style` 1 or 2 means a visible box: style 2 (rounded, width/height 0.28, radius 0.4) is the common real setting. The importer used to treat alpha > 0 as on, which gave about 1,900 of 1,987 local texts a box they don't have; fixed.

**Calibrated against CapCut** (see [calibration.md](calibration.md)): transform units match the model (half-canvas, +y up, clockwise, contain-fit scale); track flags are 1 = muted, 2 = hidden, 4 = locked; hidden tracks are silent too; stacking follows track order in CapCut's default track mode; one text size unit = 0.005789 of the canvas width as an em size. Session 2 measured CapCut's rendering pipeline (native export resolution, two-pass resampling with a sharpened downscale, neutral colour path, text size proportional to canvas width); image borders, other scale factors, opacity and portrait text are in session 3.

**Still to verify against CapCut exports:**
- Keyframe value units for the text, Adjust and HSL types (no local draft keys them; [keyframes.md](keyframes.md)). The curve itself matches CapCut's own bit for bit.
