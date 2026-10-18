# Plan: engine features for CapCut parity

Agreed 2026-10-16. What the engine draws next is chosen from two sources: what real CapCut projects use (the 63 local drafts: 3,104 clips, 13,831 materials), and CapCut's full feature set ([inventory](../inventory/capcut.md)), for projects people bring over. Every feature is checked against CapCut's own output, from a calibration draft exported once from CapCut or an existing export ([protocol](../parity/README.md)).

## What the local drafts use

| Feature | Use | Engine (2026-10-16) |
|---|---|---|
| Video and photo clips | 59 drafts | ✅ |
| Caption text clips (`subtitle`) | 1,840 clips, 27 drafts | ✅ stroke (1,755), background, wrap, bold/italic |
| Word-by-word captions (`caption` animations) and subtitle templates (`text_templates`) | 43 + 43, 6 drafts | ✅ the word-colour and "pop" styles (38 of 43, [captions.md](../parity/captions.md)); ❌ multi-line (5) |
| Library text styles (`text_effect`) | 185, 16 drafts | ✅ both kinds ([capcut-bundles.md](../parity/capcut-bundles.md)) |
| Text spacing, glow, gradient fills, several strokes | spacing on 50 captions in 1 draft; the rest 0 | ✅ drawn with CapCut's maths, unchecked against its output (2026-10-18, [text-styles.md](../parity/text-styles.md)); OpenRip's own Effects styles and presets for new text; ❌ bubbles (library image bundles) |
| Curved text (`text_curve`) | 3 enabled (125 carry it switched off), 1 draft | ✅ fitted to its export, provisional ([curved-text.md](../parity/curved-text.md)) |
| Text shapes (`text_shape`) | 122, 5 drafts | Nothing to draw: they name a "Bubble" with no bundle, and CapCut's covers and export show plain text |
| Text intros | 47, 22 drafts | ✅ Type 1, Type 2, Typewriter (40); ❌ 7 others (single uses under 2.6 s; Preview Type's 2 run under 0.4 s) |
| Adjust sliders | 5 drafts | ✅ 9 within ±2 code values; fade, clarity, vignette as close as plain video (2026-10-17, [colour.md](../parity/colour.md)); ❌ temperature/tint on fine detail |
| HSL, curves | 1 draft each (3 ranges; 40 clips) | ✅ (2026-10-17, [colour.md](../parity/colour.md)); ❌ log wheels (no local use) |
| Audio clips, fades, loudness | 7–35 drafts | ✅ |
| Speed changes, keyframes (opacity, position) | 14 and 12 uses | ✅ with CapCut's curves, bit for bit, and every keyframe type the engine draws ([keyframes.md](../parity/keyframes.md)) |
| Stabilisation | 12, 2 drafts | ❌ |
| Transitions | 8, 2 drafts | ✅ Blink, White Flash, White Fade ([transitions.md](../parity/transitions.md)); built-ins any project can use: Mix, Black Fade, Pull in, Pull out, Blur, Slide, Push, Wipe, Circle, Spin |
| Video and photo In / Out / Combo animations | 0 | ✅ a basic built-in set (fade, zoom, slide, rotate, spin, bounce, shake; swing, pulse), CapCut's Fade Out from its bundle ([clip-animations.md](../parity/clip-animations.md)) |
| Voice effects | 8, 5 drafts | ✅ Deep, Low, Voice Crisper, Demonized; Deep 2 without its reverb ([voice-effects.md](../parity/voice-effects.md)) |
| Masks | 2 drafts | ✅ Rectangle, matching both covers ([masks.md](../parity/masks.md)); circle, linear, mirror and heart from their bundles, the star if its bundle is the heart's kind (no local use to check against); ❌ pen |
| Stickers | 11, 4 drafts (1 shown; the rest on hidden tracks) | ✅ PNG and GIF stickers from CapCut's cache (2026-10-17, [stickers.md](../parity/stickers.md)); their size is provisional, unchecked against CapCut |
| Blend modes, chroma key | 0 | ✅ all eleven modes and the chroma key from the bundles CapCut ships, checked against their shaders' formulas (2026-10-18, [compositing.md](../parity/compositing.md)) |
| Canvas fills, flips | 909 canvases (all black), 1 flip (on a hidden track) | ✅ colour, image, and blur (its strength provisional) for the main track's clip, also inside transitions; flips, sideways video too |
| Video effects | 1 | ❌ its bundle isn't in CapCut's cache |
| AI features (matting, smart crop, AI denoise) | 1–29 | No models in OpenRip; background removal draws from the masks CapCut saved in the draft ([cutouts.md](../parity/cutouts.md)) |

## Library content

CapCut's effects, transitions, stickers, text styles and templates are content it downloads. OpenRip does both:
- **Imported projects:** it draws CapCut's own bundles from CapCut's cache on the machine, as it does text styles, reading their parameters and reimplementing the rendering (nothing from a bundle is copied into the repo).
- **New projects:** OpenRip ships its own built-in sets that behave like CapCut's most-used items.

## Order

1. **Captions.** Word-by-word highlighting and subtitle templates, text shapes, and the remaining intros. Captions are most of the text in the local drafts, and CapCut's signature.
2. **Motion and compositing.**
   - Transitions: a built-in set, plus CapCut's from its cache.
   - Masks (rectangle, circle, linear, mirror, heart, star; feather, invert).
   - Blend modes and canvas backgrounds (blur, colour, image): done 2026-10-18; speed curves.
   - Chroma key (done 2026-10-18), freeze frame.
3. **Effects and stickers.** Built-in effects (shake, glitch, blur, grain, …), CapCut's effects from its cache, and image, GIF and animated stickers.
4. **Audio.** Voice effects (pitch, formant), noise reduction by DSP, beat markers.
5. **Stabilisation**, by classical feature tracking.

In parallel, the app integration continues ([app-engine-integration.md](app-engine-integration.md)): the app's own filters, shapes and masks in the engine, export through the engine, then removing the old preview path.
