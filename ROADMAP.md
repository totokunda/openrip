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
- **Frame transport:** Electron's **`sharedTexture`** (experimental, Electron 44). The engine hands IOSurface / DXGI / dmabuf GPU textures to the renderer, which draws them with WebGPU. There is no copy, and the HTML UI (handles, menus, overlays) composites normally on top.

Spike results (`spikes/frame-transport`, Apple M2 Max, hardware HEVC decode):

| Path | 4K60 | 8K30 | Main-thread cost per frame (p95) |
|---|---|---|---|
| **`sharedTexture` → WebGPU** (chosen) | 60 fps, 0 drops | 30 fps, 0 drops | 0.6–0.8 ms |
| Native CALayer inside the window (fallback) | 60 fps, 0 drops | 30 fps, 0 drops | 0.13–0.17 ms |

- **Whole app measured externally, CapCut-style:** 4K60 playback (decode plus display only) costs about 37% of one core across all processes, hardware decode included, and 511 MB of memory. The CapCut column is pending ([results](docs/parity/results/)).
- **Keep frames in YUV (NV12/P010) end to end.** Asking the decoder for BGRA dropped frames at 4K60.
- **The native layer is cheaper but can't sit under HTML.** Above the web UI it hides popovers; below it needs a transparent window. It stays as a fallback in case `sharedTexture` regresses.
- **Fallback order:** if both paths fail on a platform, the last resort is a Rust host with CEF in offscreen mode.
- **Still to validate:** Windows (DXGI) and Linux (dmabuf) transport, transport with `contextIsolation` enabled, and the CapCut head-to-head.

### 2.2 Engine crates (Cargo workspace)

| Crate | Responsibility |
|---|---|
| `openrip-model` | Project and timeline data model mirroring CapCut's concepts (tracks → segments → materials, microsecond time, `Animated<T>` keyframes with bezier easing, render order); undo/redo as commands; v1 JSON importer; v2 format |
| `openrip-capcut` | CapCut draft import (and later export), with versioned schema adapters. Unmappable proprietary library items (effects, stickers, templates, fonts) become placeholders in an import report. |
| `openrip-media` | Demux/decode through FFmpeg (`ffmpeg-next`/`rsmpeg`) with hardware decode: VideoToolbox, D3D11VA/NVDEC, VAAPI. Also frame cache, thumbnails, waveform peaks and proxies. |
| `openrip-render` | wgpu compositor; WGSL shaders for adjustments, 3D-texture LUTs, blur/sharpen/noise/vignette, and lasso/shape masks with feathering; text (cosmic-text/glyphon); shapes (lyon). Zero-copy upload from hardware frames where the platform allows it (IOSurface→Metal, DXGI, dmabuf). |
| `openrip-audio` | cpal output, mixer, fades, resampling (rubato), time-stretch for speed changes |
| `openrip-playback` | Master clock, A/V sync, prefetch scheduler, frame-accurate seek, dropped-frame policy |
| `openrip-export` | Offline render graph feeding FFmpeg encoders, including hardware ones (VideoToolbox, NVENC, QSV, AMF), with parallel segment encode where the codec allows |
| `openrip-app` | UI shell, menus, shortcuts, file dialogs, packaging, auto-update |

### 2.3 Milestones

1. **M1 Open and play.** Import a v1 project and play one video track with audio, A/V in sync.
2. **M2 Compose.** Multi-track compositing, transforms, crop, opacity, adjustments, LUT filters.
3. **M3 Overlays.** Text, shapes, drawing, lasso/shape masks with keyframes.
4. **M4 Audio.** Mixing, volume, fades, speed, detaching audio.
5. **M5 Export.** Golden-corpus exports match within tolerance.
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

- **Home screen:** project grid with covers, recents, new-project aspect presets
- **Left panel tabs:** Media, Audio, Text, Stickers, Effects, Transitions, Filters, Adjustment, Templates
- **Center:** player with canvas and ratio controls, safe areas, fullscreen
- **Right inspector:** Video / Audio / Speed / Animation / Adjust tabs
- **Bottom timeline:** magnetic main track, keyframe diamonds, split/freeze/reverse, speed curves, linked audio
- **New non-AI features:**
  - transitions
  - keyframes for every animatable property
  - speed curves, reverse, freeze frame
  - chroma key, blend modes
  - classic (non-ML) stabilization
  - audio effects and beat markers via DSP
  - captions from SRT import
  - stickers and templates

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
