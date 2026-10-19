# Stickers

CapCut's library stickers ("info stickers") sit on a sticker track. Each segment points at a `stickers` material whose `path` is the sticker's downloaded bundle, `artistEffect/<id>/<hash>/` in CapCut's cache.

## The bundle

- **`config.json`:** one `InfoSticker` link. An animated sticker adds `"format": "gif"` and `"path": "final.gif"`.
- **`infoSticker.lua`:** for a still sticker, the image the sticker loads (`source = "singleImage.png"`).
- **`heycanInfo.json`:** one frame's size (`singleWidth`, `singleHeight`) and the frame count.

The importer (`capcut` crate) reads these into a `Sticker` material: the picture's path, whether it's animated, and its size. If the bundle isn't on the machine, the sticker is kept without a picture and the import warns. The preview (`playback/src/sticker.rs`) loads the PNG, or decodes the GIF (`playback/src/gif.rs`, no new dependency). A GIF's frames are composed as a browser composes them, with each frame's disposal and transparency, and loop by their delays. The sticker is drawn centred on the segment's position, scaled, turned and flipped with it, at the segment's opacity.

## Size: provisional

The size CapCut draws a sticker at, at scale 1, isn't in anything readable:
- the bundles and the drafts give only the image's size;
- CapCut's engine library has no readable source for it;
- calibration session 6, which was built to measure it, was never exported.

OpenRip draws a sticker at its pixel size on a canvas 1080 pixels wide, scaled with the canvas width, as CapCut sizes text by the canvas width. **This is a guess, not checked against CapCut.**

## In the local drafts

11 sticker segments in 4 drafts, but 10 of them are on hidden sticker tracks (track `attribute` 2): 3 in one draft, and calibration session 6's, cloned from it. CapCut doesn't draw hidden tracks, and neither does OpenRip. The one shown is an animated countdown (a 280×280, 100-frame GIF) at scale 1 in the middle of draft F, 52 s in. That draft's export, and its video, are on the external disk, which couldn't be read during this work. So no CapCut frame with a sticker has been compared yet.

When it's readable again: `openrip-dev export-parity <draft F> <its export> --from 51.9 --to 55 --every 0.25 --all --save <dir>` shows whether the size and the GIF's timing match.

## Checks

- **Unit tests:** GIF composition with transparency, disposal and delays; LZW strings from the table and deinterlacing; looping by the delays; the bundle's picture for a PNG and a GIF sticker.
- **Rendering:** calibration session 6 with its sticker track shown. The 540×540 sticker at scale 0.5, 200 px right and 300 px up of the middle, lands where the draft puts it. Draft F's countdown shows its digits in turn.
- **App** (smoke step `capsticker`):
  - the engine draws the sticker in the app;
  - the bar's Filter tab names it and shows its opacity on CapCut's 0–100%;
  - setting the opacity to 30% fades the sticker.
- **Round trip:** the draft with visible stickers comes back exactly (138.1 dB).
- **Cover parity:** no draft has a visible sticker at its first frame, so no cover changed.

## OpenRip's own sticker library (Stickers tab)

CapCut's stickers are content OpenRip can't ship. The Stickers tab is a library of openly licensed sets in CapCut's layout. A sticker clip (`type: "sticker"` in the app, a `Sticker` material on a `sticker` track in the engine) is modelled the way CapCut's are: a picture or an animation on a track of its own, with a transform, an Animation tab (In, Out, Loop) and keyframes.

### Sources and licences

Each set's licence and credit are in the manifest and in the app's third-party notices (`scripts/third-party-notices.mjs` reads them). The manifest is made from the sources' repositories, pinned to the commits it read, by `scripts/build-sticker-manifest.mjs`.

| Set | Files | Licence | Items |
|---|---|---|---|
| Fluent Emoji 3D (github.com/microsoft/fluentui-emoji) | PNG | MIT (the repo's LICENSE) | 1,595 |
| Fluent Emoji Color | SVG | MIT | 1,595 |
| Fluent Emoji Flat | SVG | MIT | 1,595 |
| Noto Emoji 2D (github.com/googlefonts/noto-emoji) | 512 px PNG | Apache-2.0 (README: "most image resources are under the Apache licence"; `2D/svg/LICENSE` is Apache-2.0) | 1,595 |
| Animated Noto Emoji (googlefonts.github.io/noto-emoji-animation) | 512 px animated WebP | CC BY 4.0 (credit: "Animated Noto Emoji" by Google LLC) | 595 |

- **Skin tones:** Fluent's default skin tone only. Noto's pictures are matched to Fluent's names through the emoji's codepoints, since Noto has no names.
- **Animated Noto licence not checked against its repository:** `googlefonts/noto-emoji-animation` isn't public, so CC BY 4.0 is as the project gave it. The animations are shown as published, unchanged, and credited in the notices.
- **Left out:**
  - **OpenMoji (CC BY-SA 4.0):** a video with its stickers in it would arguably be an adaptation, so its share-alike term could reach the videos people make with it.
  - **Noto Emoji 3D:** the repo has no licence file of its own for it.
  - **Lottie versions of the animated emoji:** no permissive pure-Rust Lottie renderer fits the engine's portable crates; the WebP versions are the same animations.

### Delivery

- **Starter set:** 98 stickers (91 Fluent 3D, 7 animated Noto) in `packages/renderer/public/stickers/starter/` (5.7 MB), the only pictures in the repository.
- **The rest:** downloaded the first time a sticker is used, from the sources' raw files (`raw.githubusercontent.com`, `fonts.gstatic.com`) into `<userData>/stickers/<id>.<ext>`, by the main process (`StickerLibraryModule.ts`). A starter sticker is copied there the same way. The engine draws a clip from that file. The tile's picture is the file when it's cached, else the source's own URL.
- **Manifest:** `packages/renderer/public/stickers/manifest.json`, 950 KB, rows of id, name, keywords, categories, set, file under the set's base URL, thumbnail, trending rank, starter flag; the sets carry their base URL and licence.

### Engine

- **Formats:** `playback/src/sticker_decode.rs` decodes by content, not extension: PNG and APNG (frames composed by their offsets, disposal and blend), GIF, WebP still and animated (`image-webp`), and SVG (`resvg`, drawn at 512 px on the longer side). Everything is pure Rust.
- **Size:** a sticker draws at the size its material says (`Sticker.width` × `height`, else the picture's), on a canvas 1080 wide at scale 1, as CapCut's do. The importer (`v1`) turns the app's box into a scale of that size, so a box of any size and shape is drawn at it.
- **Animation and keyframes:** a sticker takes the Animation tab's In, Out and Loop and position, scale, rotation and opacity keys as a text does. An animation loops by its own frame times from the clip's start.
- **Tests:** `playback/tests/stickers.rs` (a still at its transform, an animated PNG changing frame over time and looping, an SVG with its transparency) and `v1`'s `a_sticker_clip_becomes_a_sticker_on_a_sticker_track`.

### Checks

Harness step `stickersui` (after `import timeline`; see the smoke README): browsing, search and the style filter; a click previewing; "+" adding a starter sticker with the engine's frame changing and its bar in the sticker colour; the inspector's tabs; an In animation and a keyframe; an animated sticker changing frame between two times; on-demand downloads from a local fixture server (the spinner, an SVG, an animated WebP); favourites; drags onto the timeline and the player; undo and redo of each edit; a restart; an export.
