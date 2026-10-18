# OpenRip Roadmap

**Goal:** an open-source, CapCut-class desktop video editor written in Rust, built for speed above everything else.

**Principles**

- **Speed is the feature.** Every phase has measurable performance targets, and regressions block merges.
- **Parity before redesign.** First rewrite the current editor in Rust with the same features, then make it fast, then make it look and work like CapCut.
- **CapCut is the reference.** Every benchmark and every visual test is run against CapCut on the same machine, media and edit, following [docs/parity](docs/parity/README.md). A number without a CapCut column is incomplete.
- **CapCut projects open in OpenRip.** The engine's data model mirrors CapCut's draft model (tracks → segments → materials, microsecond time, per-property keyframes), so users can bring their projects with them.
- **No AI, no cloud.** Everything runs locally with classic media processing. No model downloads, no inference, no accounts.
- **Small steps.** Each milestone ends with something that runs and can be measured.

---

## Phase 0: Repo hygiene ✅

- The `apex-studio` clone was 583 MB. 90% of that was dead binaries in old branches, tags, and duplicated history.
- OpenRip starts from slimmed history: about 60 MB, with every snapshot byte-identical.

## Phase 1: Remove AI, fork to `totokunda/openrip` ✅

Removed:

- The Python API (`apps/api`) and training code (`apps/train`)
- The launcher and installer, model, preprocessor and postprocessor UIs, AI masks, model clips, and the job, websocket and download systems
- Backend settings and API auto-update

The app now boots straight into the editor. ffmpeg/ffprobe ship inside packaged builds instead of being installed by the AI installer.

## Phase 2: Rewrite in Rust (feature parity)

### 2.0 Lock down the reference

Two references: the current TypeScript app (for porting) and CapCut (for parity).

- **Feature inventories ✅**
  - [docs/inventory/current-app.md](docs/inventory/current-app.md): every clip type, property, effect, edit and export option in today's app, with source links. Its last section lists about 90 bugs and dead-code items.
  - [docs/inventory/capcut.md](docs/inventory/capcut.md): CapCut 9.5.0's feature set, tagged by evidence, with a P0/P1/P2 parity matrix mapped to engine crates.
- **Parity protocol ✅** in [docs/parity](docs/parity/README.md): how OpenRip is measured against CapCut (performance, pixels, container, features, project import).
- **Project format spec.** Document the v1 JSON format as it exists today: ticks, masks, `.bin` sidecars, assets. The Rust app must import v1 projects.
- **Golden corpus.** Scenario files that generate both an OpenRip project and a CapCut draft, plus reference exports from CapCut. Rust output is compared against CapCut first, and against the TS app only where CapCut has no equivalent.
- **Baseline numbers** to beat, each with a CapCut column:
  - cold start
  - import of a 4K file
  - scrub latency
  - playback FPS with 1, 3 and 6 4K tracks plus effects
  - export speed
  - peak memory

Lessons from the current-app inventory that shape the engine:
- **Preview and export disagree today.** They differ on trim/speed mapping, blur/sharpen/noise resolution and what counts as "below" for filters. Muted tracks are still exported, and video-clip volume and fades are dropped. The engine must have **one render graph** that serves both preview and export.
- **Frames and ticks lose precision.** Integer frames are converted to ticks and back by truncation, so some frames shift by one after save and load. Store time as integer microseconds (as CapCut does) and convert only at the edges.
- **There is no undo/redo.** Every edit should be a command on the document from day one.

### 2.1 Architecture ✅ (decided)

- **UI:** React/TypeScript in **Electron** (Chromium). This is the same idea as CapCut's embedded Chromium, without having to write a browser host.
- **Engine:** **Rust**, owning decode, compositing, effects, audio and export. It mirrors CapCut's native engine, which runs in its own helper process (`VEHelper`).
- **Portable core:** the engine is an API core (`openrip-core`) meant to run on desktop, iOS, Android and the web; the Electron app is one client, through a thin Node addon. Platform code (FFmpeg, VideoToolbox, cpal, IOSurface/Metal, files, threads) sits behind seams with portable fallbacks, and `engine/scripts/check-targets.sh` checks the iOS, Android and wasm builds. Layers, seams, per-target status and the rule for new code: [portability.md](docs/plan/portability.md).
- **Frame transport:** Electron's **`sharedTexture`** (experimental, Electron 44). The engine hands IOSurface / DXGI / dmabuf GPU textures to the renderer, which draws them with WebGPU. There is no copy, and the HTML UI (handles, menus, overlays) composites normally on top.

Spike results (`spikes/frame-transport`, Apple M2 Max, hardware HEVC decode):

| Path | 4K60 | 8K30 | Main-thread cost per frame (p95) |
|---|---|---|---|
| **`sharedTexture` → WebGPU** (chosen) | 60 fps, 0 drops | 30 fps, 0 drops | 0.6–0.8 ms |
| Native CALayer inside the window (fallback) | 60 fps, 0 drops | 30 fps, 0 drops | 0.13–0.17 ms |

- **Whole app measured externally, CapCut-style:** 4K60 playback (decode plus display only) costs about 37% of one core across all processes, hardware decode included, and 511 MB of memory. See the CapCut head-to-head below.
- **Keep frames in YUV (NV12/P010) end to end.** Asking the decoder for BGRA dropped frames at 4K60.
- **First CapCut head-to-head** ([results](docs/parity/results/2026-10-15-playback-4k60.md)): 4K60 playback costs OpenRip 37% of one core and 490 MB, versus CapCut's 70% and 2.8 GB. CapCut is doing more work (audio, full UI), so this is our floor.
- **Most of our cost is Chromium compositing the 4K preview,** not the frame handoff. Prefer `<video>` presentation (25% vs 31% CPU for WebGPU), keep UI animation during playback to 60 Hz or less on promoted layers, and keep the native-layer path (12% CPU) as the efficiency ceiling to revisit.
- **The native layer is cheaper but can't sit under HTML.** Above the web UI it hides popovers; below it needs a transparent window. It stays as a fallback in case `sharedTexture` regresses.
- **Fallback order:** if both paths fail on a platform, the last resort is a Rust host with CEF in offscreen mode.
- **Still to validate:** Windows (DXGI) and Linux (dmabuf) transport, transport with `contextIsolation` enabled, and the CapCut head-to-head.

### 2.2 Engine crates (Cargo workspace)

| Crate | Responsibility |
|---|---|
| `openrip-core` | The engine's API as plain Rust, for every binding: projects in, preview sessions (frames, playback clock, edits), thumbnails and waveforms, export, CapCut conversion ([portability.md](docs/plan/portability.md)) |
| `openrip-node` | The Electron app's binding: napi conversion over `openrip-core` |
| `openrip-platform` | Seams for asset access (files today; handles, URLs and blobs later) and background tasks (OS threads today) |
| `openrip-frame` | Decoded pictures and pixel types, shared by the decoders and the compositor |
| `openrip-model` | Project and timeline data model mirroring CapCut's concepts (tracks → segments → materials, microsecond time, `Animated<T>` keyframes with bezier easing, render order); undo/redo as commands; v1 JSON importer; v2 format |
| `openrip-capcut` | CapCut draft import (and later export), with versioned schema adapters. Unmappable proprietary library items (effects, stickers, templates, fonts) become placeholders in an import report. |
| `openrip-media` | Demux/decode through FFmpeg (`ffmpeg-next`/`rsmpeg`) with hardware decode: VideoToolbox, D3D11VA/NVDEC, VAAPI. Also frame cache, thumbnails, waveform peaks and proxies. |
| `openrip-render` | wgpu compositor; WGSL shaders for adjustments, 3D-texture LUTs, blur/sharpen/noise/vignette, and lasso/shape masks with feathering; text (cosmic-text/glyphon); shapes (lyon). Zero-copy upload from hardware frames where the platform allows it (IOSurface→Metal, DXGI, dmabuf). |
| `openrip-audio` | cpal output, mixer, fades, resampling (rubato), time-stretch for speed changes |
| `openrip-playback` | Master clock, A/V sync, prefetch scheduler, frame-accurate seek, dropped-frame policy |
| `openrip-export` | Offline render graph feeding FFmpeg encoders, including hardware ones (VideoToolbox, NVENC, QSV, AMF), with parallel segment encode where the codec allows |
| `openrip-app` | UI shell, menus, shortcuts, file dialogs, packaging, auto-update |

### 2.3 Milestones

0. **M0 Project format + CapCut import** (in progress, `engine/`).
   - Done: `openrip-model` (µs time with exact frame-rate maths, `Animated<T>`, CapCut-shaped tracks/segments/materials) and `openrip-capcut`. All 56 local CapCut drafts import with zero structural problems ([coverage](docs/parity/capcut-import.md)).
   - Done: edits as serializable commands (add/remove/move/trim/split/speed/properties/tracks/materials). Undo/redo replays recorded inverses and is atomic, with gestures merged into one step. Verified by 2,000 randomized sequences (181k edits) undoing exactly to the original.
   - Done: `openrip-v1` importer for the TypeScript app's projects (exact frame recovery, geometry conversion, dB→gain, overlap repair). All 7 local projects import cleanly.
   - Done: colour-tool materials (HSL, tone curves with a bezier evaluator, primary/log wheels), mapped from CapCut.
   - Done: CapCut calibration sessions 1–2 ([calibration.md](docs/parity/calibration.md)). Track attribute bits, transform units, the text size unit (proportional to canvas width) and CapCut's rendering pipeline (native export resolution, sharpened two-pass resampling, neutral colour path) are all measured. Session 3 (image borders, other scale factors, opacity, portrait text) is generated and waiting to be exported from CapCut.
   - Done since then: shapes, drawings and masks in the model (the app's, and CapCut's rectangle mask).
1. **M1 Open and play.** Import a v1 project and play one video track with audio, A/V in sync.
   - Done: `openrip-media` decoder.
     - Native asynchronous VideoToolbox for H.264/HEVC, 3–4× FFmpeg's hwaccel; FFmpeg for everything else.
     - Frame-accurate `frame_at` that skips pictures nothing references.
     - Open-GOP handling, and a frame cache for stepping backward.
     - 4K phone footage seeks in 41 ms p50. See [results](docs/parity/results/2026-10-16-decode.md) and [how CapCut does it](docs/parity/capcut-decode.md).
   - Done: `openrip-playback`.
     - `FrameServer`: scrub and accurate seeks, newest seek wins.
     - `PreviewEngine`: project + time → frame.
     - `Player`: cpal audio output whose played samples are the master clock.
     - In `spikes/engine-preview`, CapCut drafts play with sound, the picture following the audio clock (A/V offset p50 0 ms, p95 21 ms).
   - Done since then: prefetch of upcoming clips, and the render-ahead `PreviewPipeline` (every frame on time on the hardest local drafts).
   - Done since then: the app's preview and playback run on the engine behind a setting ([docs/plan/app-engine-integration.md](docs/plan/app-engine-integration.md)).
   - Next: engine features in the order of [docs/plan/capcut-parity-roadmap.md](docs/plan/capcut-parity-roadmap.md), chosen from what CapCut projects use: captions first.
2. **M2 Compose.** Multi-track compositing, transforms, crop, opacity, adjustments, LUT filters.
   - Started: `openrip-render`, a wgpu compositor with CapCut's measured resampling pipeline, transforms and opacity. It matches CapCut's exports as closely as the reference model does. `openrip-dev render-frame` renders imported projects.
   - Done: zero-copy NV12/P010 IOSurface input from the decoder, rendering into IOSurfaces, and text (shaping, stroke, background). `PreviewEngine` renders all 58 local CapCut drafts. `openrip-node` plus `spikes/engine-preview` play a CapCut draft in Electron 44 through `sharedTexture`, end to end with no copies.
   - Done since then: the app runs on Electron 44 with the engine as its default preview and exporter, drawing everything its old preview did ([app-engine-integration.md](docs/plan/app-engine-integration.md)); the addon links a minimal static LGPL FFmpeg, so it needs nothing installed.
3. **M3 Overlays.** Text, shapes, drawing, lasso/shape masks with keyframes.
   - Done (2026-10-18): the text tools' data model and engine: CapCut's spacing, glow, gradient fills and several strokes, from drafts and on the app's own text; OpenRip's own Effects styles and Add-text presets; SRT/VTT caption import and SRT export ([text-styles.md](docs/parity/text-styles.md)). The glow and gradients follow CapCut's maths, unchecked against its output until calibration session 7 is exported. Not done: bubbles.
   - Done (2026-10-18): the engine draws the app's bundled web fonts (WOFF2 decoded in Rust, one file per script with each character from the file that has it) and the installed ones by family name, with their real bold and italic faces; a text in each matches the browser's glyphs at IoU 0.88–0.97 (harness `fontcheck`). Underline is drawn.
4. **M4 Audio.** Mixing, volume, fades, speed, detaching audio.
   - Started: `openrip-audio`, a decoder plus a mixer with CapCut's mute/hide rules, volume keyframes and fades. On session 1 its mix matches CapCut's exported audio sample for sample (correlation 1.0000, level ratio 1.002). Done since then: pitch-preserving speed changes (FFmpeg atempo, CapCut's default), with `change_pitch` (CapCut's `is_tone_modify`) resampling instead, and audio output with the master clock (`Player`, cpal). Done since then: reversed audio (CapCut's copy played backward where there is one) and speed curves played varispeed, as CapCut plays them ([speed.md](docs/parity/speed.md)). Done since then: the Audio tab's tools: OpenRip's own voice effects for the app's clips and CapCut's reverbs and echo for drafts ([voice-effects.md](docs/parity/voice-effects.md)), loudness normalisation measured as CapCut measures ([loudness.md](docs/parity/loudness.md)), channel fill, volume keys followed sample by sample, beat markers with beat detection ([beats.md](docs/parity/beats.md)), and voiceover recording behind an input seam.
5. **M5 Export.** Golden-corpus exports match within tolerance.
   - Started: `openrip-export` (video and AAC audio). Session 2's draft exported by OpenRip matches CapCut's own export at 57–64 dB on stills and 42 dB rotated. 6–8× real time. See [results](docs/parity/results/2026-10-16-export.md).
6. **M6 Editor UI parity.** Timeline editing (trim, split, group, snap, copy/paste), properties panels, media library and proxies, autosave.
7. **M7 Ship.** CI on macOS, Windows and Linux; signed installers; auto-update from `totokunda/openrip` releases.

## Phase 3: Speed at parity

- **Instrument everything:** `tracing` + Tracy, `criterion` benchmarks, and a perf CI job that fails on regressions.
- **Initial targets** (to be adjusted after the 2.0 baseline):
  - cold start under 1 s
  - 4K60 H.264/HEVC playback in real time with 3 tracks plus effects on Apple M1-class hardware
  - scrub-to-frame latency under 50 ms (with proxies)
  - 1080p export at 4× real time or better with hardware encoding
  - steady-state memory under 1.5 GB for a typical project
- **Techniques:**
  - GPU-resident frames end to end
  - decode-ahead pools per track
  - an LRU frame cache keyed by (asset, pts, scale)
  - rendering only dirty regions in the timeline UI
  - multi-threaded export pipeline

## Phase 4: CapCut-style redesign

Match CapCut's layout and workflows. Don't copy its assets.

- **Home screen ✅:** a sidebar (Home, Templates, Library), a Create project banner with sizes (16:9, 9:16, 1:1, 4:3, 4:5, 21:9, 2:3), quick starts (Open a CapCut project, Import media, Continue), and the projects as a grid or list with covers, length and size, sorted by last edited (or newest, or name) with a search. The editor's top bar goes back home, and the engine's frame becomes the project's cover. Still to do: the first clip dropped on an empty timeline sets the canvas to its own ratio even when the project was made at a chosen size (CapCut keeps a chosen ratio).
- **Settings, shortcuts and the menu bar ✅:** CapCut's Settings window (Draft, Edit, Performance, General; Cancel and Save) with each row acting where the app does it: the projects folder, the cache's age and size, frame rate of new projects, time code, image duration, step and adjust amounts, target loudness, sound and notification on export, hardware decoding, auto optimization, language (English, ready for more) and software update; rows OpenRip can't honour yet show disabled with a note. The Shortcuts window: CapCut's actions in four tabs, click to rebind (conflicts refused), five presets, Reset; the handlers follow it (`lib/keymap.ts`). The home screen's gear (Settings, Third-party copyright, Version), About, the open-source notices made from the npm and Cargo lockfiles, and the menu bar's app menu (About, Settings, Back to home page, Layout, More, Quit; Help ▸ Shortcuts). Still to do: the rows shown disabled (screen recording, presets, scrubbing audio, linkage by item type, free layers, proxies by default, the rendering cache), copy and paste attributes, J/K/L.
- **Left panel tabs:** Media, Audio, Text, Stickers, Effects, Transitions, Filters, Adjustment, Templates
  - Done: the tab row (with Captions) and each tab's column of sections; Media (search, grid or list, Added badges), Filters, Text (add text in eight styles, In animations) and Transitions (CapCut's grid of the engine's transitions by category, animated cards drawn by the app, + or a card dragged onto a cut) work; Stickers, Effects, Adjustment, Templates and the footage library say what's coming. Still to do: their libraries, Media's Record, a detachable panel.
  - Done (2026-10-18): Audio: Extracted (each video's sound, the Extract audio card), Voiceovers (the project's takes) and Music and Sound effects, which import local audio while their libraries are to come. Still to do: those libraries, previewing a sound on click, Favorites.
  - Done (2026-10-18): Text as CapCut's (Add text's default tile, the presets by category as tiles the app draws, click or drag to add at the playhead, Local captions) and Captions (an .srt or .vtt onto its own track in a chosen style, caption style templates for a whole track, export as .srt; no auto captions). Still to do: Yours ▸ Favorites and saved presets, text templates.
- **Center:** player with canvas and ratio controls, safe areas, fullscreen
  - Done: as CapCut's. The header menu: Color oscilloscope (RGB parade, waveform and vectorscope under the canvas, drawn on the GPU from the engine's frame), Guides and rulers (rulers ⌘⌥R, guides ⌘; dragged out of the rulers, saved in the project and undone, clips snapping to them, Edit guide and Delete guide), Export still frames (a PNG at the project's size by the engine). Under the canvas: the time as HH:MM:SS:FF and a stereo meter of the engine's mix, play, safe areas, preview quality (Full, High, Medium, Low; playback only), the zoom popover (and a navigator while zoomed), ratio and full screen (⌘⇧F, CapCut's floating bar). Still to do: CapCut's ratio list (Original, 2.35:1…).
- **Right inspector:** Video / Audio / Speed / Animation / Adjust tabs
  - Done: CapCut's tabs and sub-tabs (Video ▸ Basic / Mask, Audio, Speed, Animation, Adjust; Text ▸ Basic / Effects, Animation, Duration) over the existing panels, with CapCut's label column and fields; the project's Details and Modify with nothing selected. Animation as CapCut's: In / Out / Combo (In / Out / Loop on a text) grids of cards with moving previews and the duration in the footer, a draft's own animations kept by name, caption styles for spoken words. Speed as CapCut's: Standard (0.1–100× on its slider, the length, Change audio pitch, Reset) and Curve (None, Custom and its six presets, an editor for the curve's points: drag, add and delete at the playhead, reset). A transition selected on the timeline has its own inspector (duration, direction, reset, Apply to all).
  - Done (2026-10-18): the Audio tab as CapCut's (a video's Audio ▸ Basic / Voice changer, an audio clip's Basic, Voice changer, Speed): Volume with keyframes, fades, Normalize loudness (measured by the engine, its gain shown), Fill channel (and Mono), the 25 voice presets as tiles with their sliders, search, groups and Apply to all, a draft's own voice filter, and "Audio is separated" with Recover audio. Still to do: Reduce noise (classic DSP), the voice presets' favourites.
  - Done (2026-10-18): Text ▸ Basic in CapCut's order (the font menu with the bundled and installed fonts, size, B U I, case, CapCut's colour picker, Character and Line spacing, alignment, Transform, Stroke, Background, Glow, Shadow, gradient fill) and Effects (OpenRip's styles). Every control changes the engine's frame and undoes (harness `texttab`). Still to do: Preset style tiles and Save as preset, Curve, Background's padding and offsets, the keyframe diamonds (with PropertyRow's), Bubble (CapCut's are downloaded content).
- **Layout ✅:** to the measured spec ([docs/plan/capcut-ui-spec.md](docs/plan/capcut-ui-spec.md)): a 35 px top bar (Home, Menu, project name, layout menu, shortcuts, settings, Export), CapCut's panel proportions, gaps, corners, header strips and grey surfaces (with OpenRip's accent), Default / Media / Inspector / Vertical layouts that keep their panel sizes between sessions with Reset current layout, CapCut-style menus and dialogs, and the system's UI font.
- **Bottom timeline:** magnetic main track, keyframe diamonds, split/freeze/reverse, speed curves, linked audio
  - Done: CapCut's toolbar in its order with the timeline's own tools (split, delete left/right, marker; magnet, snapping, linkage) and its transform tools menu (Freeze at the playhead, Reverse, Mirror, Rotate; also the clip menu's Edit ›); CapCut's 18 px ruler, the Cover column before time 0, its clip colours per type and its playhead; transitions as handles on cuts (select, delete, drag their duration, drop a card on one); keyframe diamonds on the selected clip (click to go, drag to move, right-click for the ease or delete) and the keyframe graph (⌥K, over the clip: a property's curve with draggable bezier handles). The voiceover button opens CapCut's Voiceover panel (record with a 3-2-1 count while the timeline plays, level meter, time, the microphone's permission, Mute project; the take on a new audio track at the playhead). Beats: markers on clips, Mark beat and Auto beat (Beat 1 / Beat 2) from the toolbar and the clip's menu, snapping to them. The Cover tile is a placeholder. Still to do: the add and selection-tool menus, the cover editor, clip bands (label, thumbnails, waveform) as CapCut's, a speed badge on clips, the graph inside a taller clip as CapCut draws it, the voiceover's input device menu, input volume and echo reduction.
- **New non-AI features:**
  - transitions ✅ (the engine's thirteen, on cuts)
  - keyframes for every animatable property (the timeline's diamonds and graph ✅; the inspector's navigators to come)
  - speed curves, reverse, freeze frame ✅
  - chroma key, blend modes
  - classic (non-ML) stabilization
  - audio effects and beat markers via DSP ✅ (engine, the Audio tab, beats on the timeline)
  - captions from SRT import ✅ (and VTT, and export as SRT)
  - stickers and templates
  - classic versions of CapCut's AI-labelled tools (in scope since 2026-10-18; spec §6.31):
    - motion tracking: text, stickers, photos and masks follow a point or region (point or planar tracking);
    - Split scenes (shot-change detection);
    - optical-flow interpolation for Optical flow and Smooth slow-mo;
    - Auto adjust, Color match and Make colors consistent (statistics and histogram matching).

**Legal line:** reproduce layout, interaction patterns and workflows only. Don't use CapCut's name, logos, icons, proprietary effects, music, fonts or other bundled content. Use openly licensed assets instead (OFL fonts, CC0/CC-BY media).

---

## Open decisions

1. ~~UI stack (2.1)~~: decided. React/TS in Electron, Rust engine, `sharedTexture` transport.
2. FFmpeg bindings and licensing: an LGPL dynamic build or a GPL static build. This affects which encoders can ship (for example x264).
3. Whether to keep the v1 JSON format as the native format or move to a v2 format with an importer.
4. Minimum OS and GPU support (Metal / DX12 / Vulkan baseline).
5. How the engine runs: as an N-API addon in a utility process, or as a separate executable with its own IPC. `sharedTexture` import is main-process only, which affects the frame path.

## Housekeeping

- Root `.gitignore` ignores `bin/` and `**/bin/`, which would hide Rust `src/bin/`. Fix this before adding the Cargo workspace.
- Internal identifiers still say "apex" in places (env vars such as `APEX_FFMPEG_PATH`, `apex-settings.json`). Rename them during the Rust rewrite rather than churning the TS app.
- `ffprobe-static@3.1.0` ships an x86_64 binary in its `darwin/arm64` folder, so it fails on Apple Silicon without Rosetta. Today only the unused `processMediaTo24` path calls ffprobe. The Rust app should link FFmpeg libraries directly instead.
- The `clut-filters` submodule is about 910 MB (740 MB `full`, 112 MB `examples`, 55 MB `small`), while OpenRip itself clones in about 3 MB. Packaged builds already drop `full`. Decide whether to ship only `small`, split the packs into separate repos or releases, or download LUTs on demand.
- `preload/src/media/root.ts` guesses the userData folder by name instead of asking Electron, so the previews folder ignores `--user-data-dir`. Set `APEX_USER_DATA_DIR` when running isolated tests.
