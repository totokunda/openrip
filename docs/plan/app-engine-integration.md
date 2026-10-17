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
   - Checked: the app with the static addon imports the ProRes clip, draws shapes, text and adjustments, plays at 1.00× and exports in 4.2 s; the dev tool built the same way gives identical results to the Homebrew build on all 12 CapCut exports and 31 draft covers, so the minimal FFmpeg covers the drafts' media.
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
   - Still converted on import: the media panel's thumbnails and media info come from the old decoder, so a ProRes file still gets its playable copy. Using the engine's `thumbnails`/probe there removes that (step 7).
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
