# Plan: engine features for CapCut parity

Agreed 2026-10-16. What the engine draws next is chosen from two sources: what real CapCut projects use (the 63 local drafts: 3,104 clips, 13,831 materials), and CapCut's full feature set ([inventory](../inventory/capcut.md)), for projects people bring over. Every feature is checked against CapCut's own output, from a calibration draft exported once from CapCut or an existing export ([protocol](../parity/README.md)).

## What the local drafts use

| Feature | Use | Engine (2026-10-16) |
|---|---|---|
| Video and photo clips | 59 drafts | ✅ |
| Caption text clips (`subtitle`) | 1,840 clips, 27 drafts | ✅ stroke (1,755), background, wrap, bold/italic |
| Word-by-word captions (`caption` animations) and subtitle templates (`text_templates`) | 43 + 43, 6 drafts | ❌ |
| Library text styles (`text_effect`) | 185, 16 drafts | ✅ both kinds ([capcut-bundles.md](../parity/capcut-bundles.md)) |
| Text shapes (`text_shape`) | 122, 5 drafts | ❌ |
| Text intros | 47, 22 drafts | ✅ Type 1, Type 2, Typewriter (40); ❌ 7 others |
| Adjust sliders | 5 drafts | ✅ 9 within ±2 code values; ❌ fade, clarity, vignette; temperature/tint on fine detail |
| Audio clips, fades, loudness | 7–35 drafts | ✅ |
| Speed changes, keyframes (opacity, position) | 14 and 12 uses | ✅ |
| Stabilisation | 12, 2 drafts | ❌ |
| Transitions | 8, 2 drafts | ❌ (imported, not drawn) |
| Voice effects, stickers, masks, video effects | 1–5 each | ❌ |
| AI features (matting, smart crop, AI denoise) | 1–29 | Out of scope (OpenRip is AI-free) |

## Library content

CapCut's effects, transitions, stickers, text styles and templates are content it downloads. OpenRip does both:
- **Imported projects:** it draws CapCut's own bundles from CapCut's cache on the machine, as it does text styles, reading their parameters and reimplementing the rendering (nothing from a bundle is copied into the repo).
- **New projects:** OpenRip ships its own built-in sets that behave like CapCut's most-used items.

## Order

1. **Captions.** Word-by-word highlighting and subtitle templates, text shapes, and the remaining intros. Captions are most of the text in the local drafts, and CapCut's signature.
2. **Motion and compositing.**
   - Transitions: a built-in set, plus CapCut's from its cache.
   - Masks (rectangle, circle, linear, mirror, heart, star; feather, invert).
   - Blend modes, canvas backgrounds (blur, colour, image), speed curves.
   - Chroma key, freeze frame.
3. **Effects and stickers.** Built-in effects (shake, glitch, blur, grain, …), CapCut's effects from its cache, and image, GIF and animated stickers.
4. **Audio.** Voice effects (pitch, formant), noise reduction by DSP, beat markers.
5. **Stabilisation**, by classical feature tracking.

In parallel, the app integration continues ([app-engine-integration.md](app-engine-integration.md)): the app's own filters, shapes and masks in the engine, export through the engine, then removing the old preview path.
