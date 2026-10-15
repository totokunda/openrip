# OpenRip Roadmap

**Goal:** an open-source, CapCut-class desktop video editor written in Rust, built for speed above everything else.

**Principles**

- **Speed is the feature.** Every phase has measurable performance targets, and regressions block merges.
- **Parity before redesign.** First rewrite the current editor in Rust with the same features, then make it fast, then make it look and work like CapCut.
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

The current TypeScript app is the spec. Before writing Rust:

- **Feature inventory.** List every clip type, property, tool, shortcut and menu action, with links to the TS source. This becomes the parity checklist.
- **Project format spec.** Document the v1 JSON format as it exists today: ticks, masks, `.bin` sidecars, assets. The Rust app must import v1 projects.
- **Golden corpus.** Build sample projects that cover every feature, plus reference frames and exports rendered by the TS app. Rust output is compared against these, with an image-diff tolerance.
- **Baseline numbers** to beat:
  - cold start
  - import of a 4K file
  - scrub latency
  - playback FPS with 1, 3 and 6 4K tracks plus effects
  - export speed
  - peak memory

### 2.1 Choose the architecture (decision gate)

The only big open choice is the UI stack. The engine is Rust either way.

| Option | Pros | Cons |
|---|---|---|
| **A. Tauri 2 + existing React UI**, Rust engine behind commands | Fastest route to parity; reuses UI code | The preview and timeline would live in a webview. Getting GPU frames from Rust into it means copies, or a native-overlay workaround. That caps the speed ceiling. |
| **B. Native Rust UI on wgpu** (gpui, iced or Slint) | No webview. Preview, timeline and UI share one GPU context, with zero-copy frames. Highest ceiling. | The whole UI has to be rebuilt, and the UI toolkits are less mature. |

**Recommendation:** run a 2–3 day bake-off. Build the same prototype in each candidate: a timeline with 3 tracks of 4K video, a playhead, and scrubbing. Measure frame time, scrub-to-frame latency and memory. Pick on numbers. B is likely to win on speed; A is the fallback if a toolkit blocks us.

### 2.2 Engine crates (Cargo workspace)

| Crate | Responsibility |
|---|---|
| `openrip-model` | Project and timeline data model, serde, undo/redo (command pattern), v1 JSON importer, v2 format |
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

1. UI stack (2.1): settle it with the bake-off.
2. FFmpeg bindings and licensing: an LGPL dynamic build or a GPL static build. This affects which encoders can ship (for example x264).
3. Whether to keep the v1 JSON format as the native format or move to a v2 format with an importer.
4. Minimum OS and GPU support (Metal / DX12 / Vulkan baseline).

## Housekeeping

- Root `.gitignore` ignores `bin/` and `**/bin/`, which would hide Rust `src/bin/`. Fix this before adding the Cargo workspace.
- Internal identifiers still say "apex" in places (env vars such as `APEX_FFMPEG_PATH`, `apex-settings.json`). Rename them during the Rust rewrite rather than churning the TS app.
- `ffprobe-static@3.1.0` ships an x86_64 binary in its `darwin/arm64` folder, so it fails on Apple Silicon without Rosetta. Today only the unused `processMediaTo24` path calls ffprobe. The Rust app should link FFmpeg libraries directly instead.
- `preload/src/media/root.ts` guesses the userData folder by name instead of asking Electron, so the previews folder ignores `--user-data-dir`. Set `APEX_USER_DATA_DIR` when running isolated tests.
