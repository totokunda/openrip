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
