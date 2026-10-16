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

**Mapped to OpenRip types:** videos, photos, audios, texts (rich runs, stroke, shadow, background), speeds, canvas fills, audio fades, transitions, Adjust sliders (brightness, contrast, saturation, sharpen, highlights, shadows, temperature, tint, vignette, blacks, whites, exposure, fade, clarity), **HSL (8 named ranges plus custom colour, −100…100), tone curves (bezier anchors per luma/R/G/B channel), primary and log colour wheels (lift/gamma/gain/offset)**, filters/effects, and keyframes (position, scale, rotation, opacity, volume).

**Kept verbatim, not interpreted yet** (ordered by how much real projects use them):

| CapCut table | Uses | Next step |
|---|---|---|
| `material_animations` | 2,731 | Clip/text In/Out/Combo animations. These are CapCut library presets; map the common ones (fade, zoom, slide, …) to built-in animations, placeholder the rest. |
| `sound_channel_mappings` | 1,026 | Channel routing (mono/stereo); likely trivial. |
| `placeholder_infos` | 1,026 | Per-media placeholder metadata; probably ignorable. |
| `vocal_separations` | 1,026 | AI feature; unsupported by design (usually inactive entries). |
| `material_colors` | 835 | Investigate. |
| `loudnesses` | 313 | Loudness normalisation; implement in `openrip-audio`. |
| `beats` | 191 | Beat markers; P2 DSP feature. |
| `text_templates` | 43 | Library text templates: placeholder plus base text. |
| `realtime_denoises`, `smart_crops`, `vocal_beautifys` | 29 / 10 / 5 | AI features; unsupported by design. |
| `audio_effects`, `stickers`, `time_marks`, `common_mask`, `drafts` | 8 / 4 / 4 / 2 / 2 | Map as their features land (masks first). |

**Library items** (CapCut-only assets we can't ship; need built-in equivalents or placeholders): text effects 185, text shapes 122, animations 2,731, text templates 43, transitions 8, stickers 4, filters 3, a few video effects.

**Calibrated against CapCut** (see [calibration.md](calibration.md)): transform units match the model (half-canvas, +y up, clockwise, contain-fit scale); track flags are 1 = muted (inferred), 2 = hidden, 4 = locked; hidden tracks are silent too; stacking follows track order in CapCut's default track mode; one text size unit = 0.00584 of the canvas as an em size.

**Still to verify against CapCut exports:**
- The keyframe curve-control space. Every curve seen so far is `Line`, so non-linear curves are imported as linear for now.
