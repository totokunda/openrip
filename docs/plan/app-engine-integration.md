# Plan: the app's preview on the Rust engine

Status 2026-10-16: the engine side is done and measured; the app runs on Electron 44 (step 1) and ships and loads the engine on Apple Silicon (step 2). `spikes/engine-preview` plays CapCut drafts in Electron 44 through `sharedTexture`, with sound and A/V sync. What remains is wiring it into `apps/app`. That changes the editor you use every day, so it is planned here and done together.

## Today's preview (survey of `apps/app`)

| Concern | Now | With the engine |
|---|---|---|
| Compositing | React-Konva canvas2D scene, one component per clip (`renderer/src/components/preview/Preview.tsx`, `clips/*Preview.tsx`); WebGL 1 filters round-trip through 2D canvases | One surface: frames composited by `openrip-render` (CapCut-calibrated) arrive as IOSurfaces |
| Video decode | WebCodecs `VideoDecoder` in workers, mediabunny demux (`lib/media/video-decoder*.ts`) | Native VideoToolbox in the engine (3–4× FFmpeg's hwaccel), frame-accurate seek, prefetch |
| Audio | One `AudioContext` per clip, soundtouch worklet for speed (`AudioPreview.tsx`) | One mixer and one output (`Player`); CapCut's mute/hide rules; pitch-preserving speed |
| Clock | `requestAnimationFrame` loop in `useControlsStore` (`lib/control.ts`, `__playbackTick`) | The audio clock: samples actually played |
| Process / bridge | `contextIsolation: true`; preload exposes modules with `contextBridge`; no native addons | The `openrip-node` addon in the main process; the preload exposes a small preview API |
| Electron | 38.7.2 | 44 (`sharedTexture`) |

Konva stays for everything drawn over the picture: transform handles, masks, drawing, lasso, cursors.

## Steps (each one shippable, behind a setting until parity)

1. **Electron 38 → 44.**
   - Bump, rebuild, and run the existing smoke tests (Playwright Electron recipe) and a manual pass.
   - No native modules are involved, so the risk is Chromium/API changes in our code.
2. **Ship the addon.** Done for Apple Silicon (2026-10-16).
   - `scripts/build-engine.mjs` builds `openrip-node` into `native/<platform>-<arch>/` (run by `npm start` and `npm run build`); electron-builder packs it into `resources/engine/`.
   - The main process loads it (`modules/EngineModule.ts`); the preload's `engineInfo()` tells the UI whether it's there and its version. Without it the app runs on its own preview.
   - Checked: dev mode and a packaged `OpenRip.app` (arm64, unsigned) both load it; with it missing, the app imports, plays and edits as before.
   - FFmpeg is linked in statically (2026-10-16): `engine/scripts/build-ffmpeg.sh` builds FFmpeg 9.0.2 (the version the bindings target; tarball checked against its release signature) as static LGPL libraries with only the demuxers, decoders, encoders, parsers and filters the engine uses, into `engine/.ffmpeg/<arch>/`. `build-engine.mjs` runs it once per architecture, builds the addon with the `static-ffmpeg` feature in its own target dir (`engine/target/addon`), and fails if the addon links anything outside `/usr/lib` and `/System`, or leaves a compiler builtin undefined. Before, the addon loaded Homebrew's FFmpeg from `/opt/homebrew`, so it only worked on Macs that had it, and Homebrew's build carries GPL encoders.
   - Napi addons link with `-undefined dynamic_lookup`, so a missing symbol fails only when called: FFmpeg's `__builtin_available` checks need compiler-rt (`libclang_rt.osx.a`), which rustc doesn't link; without it the addon crashed on the first VideoToolbox frame.
   - Static LGPL linking is allowed because the app's source is public (LGPL's relinking terms).
   - Intel: `node scripts/build-engine.mjs --arch x64` cross-builds FFmpeg and the addon. Without `nasm` installed, FFmpeg's x86 assembly is left out (software decoding is slower; VideoToolbox decodes H.264, HEVC and ProRes either way). On x86_64, FFmpeg's AVFoundation link pulls in the Swift CoreMedia overlay, which macOS keeps in `/usr/lib/swift`; the addon gets an rpath there. It builds and links with nothing outside the system, but hasn't run yet: this Mac has no Rosetta.
   - Checked: the app with the static addon imports the ProRes clip, draws shapes, text and adjustments, plays at 1.00× and exports in 4.2 s; the dev tool built the same way gives identical results to the Homebrew build on all 12 CapCut exports and 31 draft covers, so the minimal FFmpeg covers the drafts' media. A packaged, unsigned `OpenRip.app` (arm64) loads it from `Resources/engine/`, draws with it by default, plays and exports (3.2 s for the 10 s clip).
3. **Project in, kept in sync.** Done (2026-10-16), behind Settings → Engine → "Use the Rust engine for the preview".
   - `lib/engine-preview.ts` sends the autosave's snapshot (`getActiveProjectJsonSnapshot`) to the main process 60 ms after an edit (`engine:sync-project`): opened once, then `updateProject`. An edit shows in the engine's frame at once.
   - The renderer already autosaves v1 JSON (`withJsonProjectPersistence`), and `openrip-v1` imports it in 1–2 ms.
   - First cut: send the project on load with `openProjectJson(json)` and after each edit (debounced) with `updateProject(json)`, which keeps decoders warm.
   - Later: send `openrip-model` `Edit` commands instead of whole projects.
4. **Preview surface.** Done (2026-10-16), first cut.
   - `components/preview/EngineFrame.tsx` asks for the frame at the playhead at its on-screen size (`engine:render`; the newest request wins), and draws the canvas the preload paints the shared texture into, under the clips.
   - Video, image, text, shape and drawing clips stop decoding and drawing in engine mode but keep their handles (text shows again while it's typed; an eraser stroke's live result shows until it's kept). Masks are drawn by the engine too ([masks.md](../parity/masks.md)); while the mask tool is out the engine gets the project without them, as the old preview showed clips unmasked then.
   - Checked in the app with a 10 s iPhone ProRes clip: frames arrive, scrubbing and moving a clip update the engine's picture, playback on the old clock gets 23.6 of 24 fps from the engine, and turning it off brings the old preview back.
   - Shapes and drawings are drawn by the engine since 2026-10-16 (`openrip-render::shape`, Konva's geometry for rectangles, ellipses, rounded polygons, stars and tensioned lines). In the app all five shapes and a brush and a highlighter stroke match Konva's to 1.8 levels on average, the rest being the video's resampling. The app's drawing tools name a blend each (multiply for the highlighter) but never hand it to Konva, so the engine draws every line normally too; it can multiply a layer if that's ever wanted.
   - Text lines are placed as Konva places them with `_fixTextRendering` (which the app turns on): 1-em line boxes, each baseline half the difference of Chromium's font-box ascent and descent below the box's middle. Chromium's font box is the hhea ascent and descent, with 15% more ascent for Times, Helvetica and Courier on macOS (measured in Electron on six system fonts). The engine's text now sits within 0.25 px of Konva's at a 48 px em; it had sat 0.1 em off.
   - The clip adjustments (brightness, contrast, hue, saturation, blur, sharpness, noise, vignette) are drawn by the engine as the app's WebGL filters draw them, in its order, after the masks; pixel distances are the app's world units (its working canvas is the clip fitted to a 600-unit-tall world). With all but noise set, the engine's preview matches the old one to 1.9 levels on average; noise is fresh random grain on both, so it can't match pixel for pixel.
   - Grouped clips stack where their group sits, the group's first child on top, and the group's track hides or mutes them, as `lib/clipOrdering.ts` orders them.
   - Gaps against the old preview: mask lassos saved as binary files (`lassoPointsBinPath`) aren't read when a project file is imported directly (the app sends its hydrated points). Filters from the Filters panel (Hald CLUT images) are drawn since 2026-10-16: read as ImageMagick does (edge-aligned, trilinear) and mixed by intensity; the app's own preview and the engine's agree to 0.7 levels on average.
   - Add `EnginePreview.tsx`: one canvas (or a `<video>` fed by `MediaStreamTrackGenerator`, cheaper per the spike) that draws frames received through `sharedTexture.setSharedTextureReceiver`.
   - It replaces the clip-mapping block in `Preview.tsx` and `FullscreenPreview.tsx`. Overlays stay.
   - **Verified:** `spikes/engine-preview` now runs exactly this way: `contextIsolation` on, the preload receives the frames and draws them into the page's canvas (the preload world shares the DOM, so no `VideoFrame` crosses `contextBridge`). A real draft plays at 23.9 of 24 fps.
5. **Playback and scrubbing.** Done (2026-10-16) in engine mode.
   - Play starts the engine's playback (`engine:play`): it plays the mixed sound and renders ahead of its audio clock; each display tick main sends the frame due now and its time (`engine:clock`), which moves the playhead. Pause stops it where the sound stopped; at the end it stops (`engine:ended`). Runs carry a token so ticks from a stopped run are dropped.
   - The app's frame timer gives way through a `PlaybackDriver` hook in `lib/control.ts`; the per-clip audio players aren't mounted in engine mode.
   - The engine gets original files: `engineSourcePaths` maps proxies and playable copies back to them before each sync, so iPhone ProRes plays from the original (hardware decode, 414 fps on a 1080p clip).
   - Checked: the playhead follows at 0.99x real time with 72 frames in 3 s (24 fps), pause holds, playing on after a seek stops at the end, and switching back to the old player works.
   - No playable copy when the engine draws (2026-10-16): a video the app's own decoder can't read (ProRes) keeps its track in the media info for its size and rate (`videoDecodable: false`), and the app's frame fetching (`lib/media/canvas.ts`, `video.ts`) gets its frames from the engine's thumbnailer (`engine:thumbnails`, exact frames, cached on disk) through a stand-in for mediabunny's `CanvasSink`. Importing the standard ProRes clip no longer converts it, and its timeline strip comes from the engine. Without the engine the copy is made as before.
   - Main runs the `PreviewPipeline` (render-ahead).
   - On each display tick it takes the frame for the `Player` clock and sends it.
   - It pushes the clock to the renderer, which sets `focusFrame` from it in place of `__playbackTick`.
   - Seeks and scrubs go to `pipeline.seek` (newest wins). The per-clip `AudioContext`s go.
6. **Export.** Done (2026-10-16) in engine mode.
   - With the engine preview on, H.264/HEVC video in MP4, MOV or MKV without alpha goes through `openrip-export` (GPU compositing → VideoToolbox, the engine's mix as AAC 44.1 kHz): `exportProject` on a worker thread, `exportProgress` polled by main every 200 ms (`engine:export-progress`), `cancelExport` from the dialog's cancel. It exports the same snapshot the preview gets, with original media.
   - WebM, VP9/AV1/ProRes, alpha and stills stay on the app's exporter.
   - Checked in the app: a 10 s 1080P export of the standard clip in 2.3 s, H.264 + AAC, 10.04 s long.
   - The resolution now sets the short side for both exporters (1080P portrait is 1080×1920, as in CapCut); it had set the height, so portrait came out 608×1080.
7. **The engine by default.** Done (2026-10-16): the setting is on unless the user turned it off, now that the engine draws everything the old preview did (video, photos, text, shapes, drawings, masks, the Filters panel's LUTs, clip adjustments, groups). Checked on a fresh profile: the engine draws from the start, the setting turns it off and on, and a 10 s 1080P export with shapes, drawings, text and adjustments takes 4.2 s.
8. **Remove the old path**: the clip components' own drawing and decoding, the WebGL filters and masks, the old exporter for what the engine exports, and the media panel's old thumbnails and probe (so a ProRes file needs no playable copy). Keep it until the engine has run as the default for a while.

## CapCut projects in the app

Done (2026-10-16): Projects ▸ Open CapCut Project… lists the drafts CapCut shows on its home screen (with their covers), or takes a draft folder, and makes a new OpenRip project from it. The draft is only read.

- **How a draft becomes an app project.** The engine imports the draft into its model and writes the app's own project format (`openrip-v1` `to_app_project`, addon `capcutToApp`): tracks in CapCut's stacking order (sound at the bottom), clips the editor knows (video, image, audio, text; effects, filters, stickers and adjustment layers as named filter clips), a box around each text where the engine lays it out, and the draft's exact canvas as the aspect ratio. Media are linked into the project's media folder, as the app's own imports are, and CapCut's cover becomes the project's.
- **What the engine keeps.** Each clip also carries the CapCut segment it came from, the materials that segment uses, and its own fields as written (`engine` on the clip). When the app sends the project back, the importer rebuilds the segment and applies on top only what the app changed: a move, resize or turn (applied to CapCut's own transform, keyframes included), a trim or retime, opacity, volume, a new text, size or colour (on a copy of the text for that clip). Caption styles, animations, effects, masks, transitions, voice effects, background removal and exact timing stay as CapCut had them. A clip split in the app keeps the payload in both halves; its clip id tells them apart.
- **Checks.** Every local draft with its media (36) converted to the app's format and back draws exactly the same frames as the draft itself (`openrip-dev app-roundtrip`); the one that didn't had lost CapCut's saved background removal, which the importer now keeps on the app's asset. In the app, a draft opens in about 5 s, plays, and its 56 s export takes 10 s and matches CapCut's own export at 40.7 dB (median, 540×960). Dragging a clip moves it in the engine's picture.
- **The panels edit CapCut clips** (2026-10-17). A converted clip also carries the panel fields for what the draft has, and the importer applies a change to any of them on top of the draft's segment:
  - **Text:** font, bold, italic, underline, alignment, letter case, stroke, shadow and background, with sizes as fractions of the font size, as for the app's own text. A CapCut background keeps its padding and rounding when its colour changes.
  - **Adjust:** the sliders go on top of CapCut's own adjustments and start at zero.
  - **Masks:** the app's masks go on top of CapCut's.
  - **Audio:** fades replace the draft's.
  - Numbers compare by value (the app writes 3 for 3.0), and a project converted before a field existed treats that field as unchanged.
- **Animation tab** (2026-10-17), for the app's own clips and CapCut's alike:
  - **Text:** the In animations the engine draws (Type 1, Type 2, Typewriter) with their duration. Captions with spoken-word timing also get a style: whole text, three words with the spoken one highlighted, or one word at a time.
  - **Video and photos:** the transition into the next clip on the track (White Flash, White Fade, and Blink when the project has CapCut's image sequence for it), with its duration.
  - A draft's animation or transition the engine doesn't draw is listed by name and kept until replaced.
  - These are the ones the local drafts use: In animations 47 times in 22 drafts, caption styles 43 times in 6, transitions 8 times in 2; no draft animates video or photos.
- **The draft's own adjustments, filters and text boxes** (2026-10-17):
  - **Adjust tab:** a video or photo lists what the draft put on it, under "From the CapCut draft" (`draftAdjustments` on the clip, by material). CapCut's Adjust sliders and the colour wheels' strength, which the engine draws, are sliders on CapCut's scale (−50…50; sharpen 0…100; the wheels in percent). Clarity, vignette, fade, HSL, curves, log wheels and any filter or effect on the clip are listed by name as not drawn yet. Each can be taken off the clip, an edited one goes back to the draft's value, and the header puts back all of the draft's. An edit goes on a copy of the draft's material for that clip. The app's own sliders still go on top. In the local drafts, CapCut's sliders are on 79 clips in 5 drafts and colour wheels on 26 clips in 1; HSL and curves that change nothing (within a level) aren't listed, which leaves one clip with HSL.
  - **Filter bars:** a CapCut filter on its own track gets the Filter tab's intensity, set to the draft's strength; it sets the strength the engine mixes the filter's table in by. Effects, stickers and adjustment layers say the engine doesn't draw them yet.
  - **Text box:** when an edit changes a CapCut text's words or style (font, case, size, bold…), `updateProject` lays it out again and returns its block (`textBlocks`), and the app's box takes the block's size about the same middle. The importer places CapCut text by the middle of its box, so the box can change size without moving the text.
  - **Case:** the Text tab's case buttons rewrite the words in the new case; the importer treats that as a case change, so a caption keeps its spoken-word timing and caption style.
  - Checked in the app: on the calibration draft with one Adjust slider per clip, brightness from −25 to 40 lightens the engine's frame (mean 0.100 → 0.165), removing it gives the plain picture, and putting the draft's back gives the same frame as before; on a draft with colour wheels, their strength at 0% darkens the frame from 0.571 to 0.510. On a draft with two filter tracks (media paths pointed at the offload volume, opened from a folder), the top filter at 0% and at 100% both change the frame, and its clips list eight sliders (two not drawn). Uppercasing the small draft's caption widens its box from 128 to 147 px, Georgia narrows it to 124 px, and its middle stays put; a word-timed caption keeps showing a page of three words after uppercasing. Harness steps: `capadjust`, `capfilter`, `capbox`, `capfolder`, `seek`.
- **Still CapCut's alone:** the draft's masks and keyframes aren't shown in the panels; video effects, stickers, adjustment layers, clarity, vignette, fade, HSL, curves and log wheels aren't drawn, so they have no settings yet.

## Speed on large projects

Done (2026-10-17), measured in the app on the largest local drafts (222, 211 and 120 clips; one has 101 photos and 113 captions). The draft with 222 clips:

| | before | after |
|---|---|---|
| open | ~10 s | ~1 s |
| seek (click to new frame) | 552 ms median, 1.9 s p95 | 170 ms median, 290 ms p95 |
| scrub | 6 frames/s, renderer blocked 9.9 s | 17 frames/s, never blocked |
| playback | 22.7 fps | 24.1 fps, no gap over 100 ms, renderer never blocked |
| an edit reaching the picture | not measured | 40–100 ms |

What it took:

- **Opening.** The engine measured every caption by drawing it (9 s); it now only lays it out (23 ms). Each clip's WebGL mask context was made up front (5 s); it's made on first use. Photo thumbnails decode at their tile size (`createImageBitmap` with a resize) and tile from one GPU upload. Every photo thumbnail also moved its clip to the end of the clip list, which re-rendered the whole project and resynced the engine once per photo, and with a hundred photos tripped React's update-depth limit; it no longer reorders anything.
- **Scrubbing.** While the playhead is dragged the engine shows the nearest decodable frame: the exact one when it's at most 3 frames ahead of where the decoder is, otherwise a decoded frame within half a second, otherwise the keyframe (`PreviewEngine::set_scrubbing`). Main renders the next frame while the last one is delivered. Since then the pictures a drag needs are got ready ahead of it (below).
- **Playback.** Clip previews don't draw while the engine does, and they re-render only when the playhead enters or leaves them (`useClipFocusFrame`). The clip previews and timeline clips are memoised, the preview hands each clip the same filter list until the clips or the filters over it change, and components subscribe to the store fields they use rather than the whole store.
- **Missing media.** A video whose frames never decode (offloaded or deleted media) made its timeline strip re-render itself in a loop, which took most of the renderer during playback and held scrubbing to 4 frames/s. It now redraws once.

The engine-only benchmarks are `openrip-dev seek-bench <draft> [--scrub]` and `pipeline-bench`; with `OPENRIP_TRACE` set, main logs each sync and frame, and the engine each frame over 30 ms (gather, layers, composite).

### Scrubbing ahead

Done (2026-10-17). Where a scrub frame's time went on the 222-clip draft (one 4K H.264 video with a keyframe every second, and two tracks of full-frame 2160×3840 subtitle PNGs changing every second or so), from `OPENRIP_TRACE`:

- **Engine, 75–150 ms whenever a subtitle changed.** The video's keyframe: ~20 ms of VideoToolbox, almost all latency. Each new still: a PNG decode on the render thread (11–30 ms), then 25–40 ms in the compositor to premultiply and upload all 33 MB of it and shrink it to a 506×900 preview. With nothing new to decode, a frame took ~6 ms.
- **Delivery, 5–17 ms.** Main hands the window the frame's IOSurface (no pixels are copied) and the preload draws it into the page's canvas. It runs beside the next frame's rendering, so it only caps the rate, at ~80 frames/s; it wasn't the limit, and isn't changed.
- **Renderer.** No long tasks while dragging.

What changed (`engine/crates/playback/src/scrub.rs`):

- **Stand-ins got ready ahead of the drag.** Each scrub frame tells the engine where the drag is. From its speed over the last 300 ms, it plans the next 300 ms of the drag (1 to 12 s of timeline): each video keyframe and each still the drag will reach, nearest first. Three worker threads get them ready while the render thread draws the current frame; the render thread waits for one a worker already has in hand and does the rest itself. Keyframes decode in parallel (4K keyframes: 21 ms each on one VideoToolbox session, 7 ms each on four).
- **Stand-ins at the preview's size.** VideoToolbox scales a keyframe as it decodes (`DecoderOptions::shrink_to`, by a whole factor so the long side stays at least the preview's): a 2160×3840 keyframe comes out 540×960, 0.8 MB instead of 12 MB. Stills are box-filtered down the same way (weighted by alpha, clear blocks of four pixels skipped: 6 ms for a 4K subtitle). Uploading a 2 MB stand-in costs next to nothing. Stand-ins have their own memory (96 MB of keyframes, 128 MB of stills) and are only shown while dragging; the frame on release is exact, as before.
- **Keyframe seeks.** Container index times can be decode times, before the keyframe is shown (B-frames), and seeking to one lands in the GOP before it. Workers seek to the middle of the GOP and file what they decode under its own keyframe.
- **Only for VideoToolbox's own decoding.** Videos FFmpeg decodes (ProRes, software) give full-size frames, and ProRes, intra-only, would plan every frame; they scrub as before.
- **Exact frames' stills decode beside their video.** A frame with a video and stills to load, or several stills, decodes the stills on the same workers instead of one after another on the render thread.
- **A memory budget for stills.** The engine kept every still it had decoded: playing or dragging through the 222-clip draft piles up to 3.4 GB of subtitles (104 of 33 MB) in each engine. Stills now share 512 MB, least recently drawn first out. A PNG that's already RGBA is no longer copied after decoding.

Measured on the 222-clip draft, main's build and this one alternating. The machine was loaded throughout (load average 20–200 from other work). When it was saturated both builds fell to 2–14 frames/s scrubbing and both dropped frames in playback, so the app's numbers are from the runs where it wasn't (13 runs, load 20–90):

| | before | after |
|---|---|---|
| scrub in the app (perf step) | 15–18 frames/s, gaps p50 37–86 ms | 41–77 frames/s, gaps p50 12–15 ms |
| engine during the scrub | 75–150 ms per frame with a new subtitle | 2–10 ms, a few at 30–70 ms |
| `seek-bench --scrub`, 120-step drag | p50 25 ms, p90 64–76 ms | p50 3–6 ms, p90 14–38 ms |
| `seek-bench --scrub`, the app's drag in real time | 17–22 frames/s, p50 61–63 ms | 218–383 frames/s, p50 2 ms |
| `seek-bench --scrub`, peak memory | 3.3 GB | 1.2 GB |
| seek (click to new frame) | 172–212 ms median | 133–183 ms median |
| playback | 22.6–24.2 fps, 0–2 gaps over 100 ms | 23.0–24.2 fps, 0–4 gaps over 100 ms |
| an edit reaching the picture | 55–63 ms | 20–61 ms |

In the calmest runs both builds play at 24.0–24.2 fps with no gap over 100 ms; the gaps above come with load, in both. `pipeline-bench` (playback in the engine alone), run 14 times alternating, shows no difference between them.

`seek-bench --scrub` now also drags in real time: the playhead crosses 80% of the project in 2 s, and each frame renders into a preview surface wherever the playhead is when the last one is done, as in the app.

Left: exact frames still upload 4K stills whole (~25 ms each); premultiplying them off the render thread would take that off seeks and the frame on release.

## Addon API

Done:
- `openProject(path)` and `openProjectJson(json)` (OpenRip, v1 or CapCut `draft_info.json`).
- `setPreviewSize(w, h)`.
- `startPlayback(fromUs)` and `stopPlayback()`.
- `seek(timeUs)`.
- `frameForDisplay()` and `release(id)`.
- `positionUs()` and `setVolume(v)`.
- `updateProject(json)`: swaps in an edited project without reopening anything. Decoders of clips that still play the same file stay open; audio already mixed (~150 ms) plays out; paused, the current frame is rendered again.

- Types for all of it: `engine/crates/node/index.d.ts`.
- `thumbnails(path, timesUs, height, exact)` and `setThumbnailCacheDir(dir)`: timeline strips, quick (one keyframe per GOP) then exact, with exact ones kept on disk. Same two-step shape as the app's `getNearestCachedCanvasSamples` then `fetchCanvasSamplesStream` in `generateTimelineThumbnailVideo.ts`.
- `waveform(path, perSecond)`: peak and RMS per bucket of the mono mix, kept in the same cache folder. The app decodes whole files with `AudioContext` in the renderer today and holds every sample (115 MB for 10 minutes); this is 8 bytes per bucket, 0.1 ms from the cache.

To add:
- A push channel for the clock, to save polling.

## Risks

- `sharedTexture` is experimental in Electron 44. The fallback, measured in the frame-transport spike, is a native CALayer under a transparent window region.
- ~~`contextIsolation` with `sharedTexture`~~: verified in the spike (step 4).
- Feature gaps against the current preview: effects, transitions, keyframe easing. The engine renders what CapCut drafts mostly use (video, photos, text with stroke and background, opacity, transforms). The rest comes in order of use.
