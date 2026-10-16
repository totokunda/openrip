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
   - Still to do: an Intel build (`--arch x64`, needs the `x86_64-apple-darwin` Rust target).
3. **Project in, kept in sync.**
   - The renderer already autosaves v1 JSON (`withJsonProjectPersistence`), and `openrip-v1` imports it in 1–2 ms.
   - First cut: send the project on load with `openProjectJson(json)` and after each edit (debounced) with `updateProject(json)`, which keeps decoders warm.
   - Later: send `openrip-model` `Edit` commands instead of whole projects.
4. **Preview surface.**
   - Add `EnginePreview.tsx`: one canvas (or a `<video>` fed by `MediaStreamTrackGenerator`, cheaper per the spike) that draws frames received through `sharedTexture.setSharedTextureReceiver`.
   - It replaces the clip-mapping block in `Preview.tsx` and `FullscreenPreview.tsx`. Overlays stay.
   - **Verified:** `spikes/engine-preview` now runs exactly this way: `contextIsolation` on, the preload receives the frames and draws them into the page's canvas (the preload world shares the DOM, so no `VideoFrame` crosses `contextBridge`). A real draft plays at 23.9 of 24 fps.
5. **Playback and scrubbing.**
   - Main runs the `PreviewPipeline` (render-ahead).
   - On each display tick it takes the frame for the `Player` clock and sends it.
   - It pushes the clock to the renderer, which sets `focusFrame` from it in place of `__playbackTick`.
   - Seeks and scrubs go to `pipeline.seek` (newest wins). The per-clip `AudioContext`s go.
6. **Export.** Switch `export-renderer` to `openrip-export` (GPU → VideoToolbox; it matches CapCut's own export at 57–64 dB on stills).
7. **Remove the old path** once the engine path covers what the old one did: shapes, drawings, masks, filters, effects (some still need calibration sessions).

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
- Feature gaps against the current preview: shapes, drawings, masks, filters and LUTs, transitions, keyframe easing. The engine renders what CapCut drafts mostly use (video, photos, text with stroke and background, opacity, transforms). The rest comes in order of use.
