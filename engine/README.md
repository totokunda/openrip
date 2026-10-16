# OpenRip engine (Rust)

Cargo workspace for the engine that replaces the TypeScript media pipeline. See [ROADMAP.md](../ROADMAP.md) §2.

| Crate | Status | What it is |
|---|---|---|
| `openrip-model` | started | Project format: microsecond time with exact frame-rate maths, `Animated<T>` keyframes, tracks → segments → materials mirroring CapCut's drafts. Edits as serializable commands (`Edit`) with exact undo/redo (`Document`) |
| `openrip-capcut` | started | CapCut draft importer (read-only) with an import report — coverage in [docs/parity/capcut-import.md](../docs/parity/capcut-import.md) |
| `openrip-v1` | started | Importer for projects saved by the TypeScript app (format v1) |
| `openrip-media` | started | Demux through FFmpeg 9; decode with a native asynchronous VideoToolbox path for H.264/HEVC in MP4/MOV (3–4× FFmpeg's hwaccel), FFmpeg (hwaccel or software) for everything else. Frames stay in IOSurface-backed NV12/P010. Frame-accurate `frame_at(t)` with forward-decode vs seek cost model, open-GOP handling, probe (codec, rate, rotation, colour). Needs FFmpeg dev libraries (`brew install ffmpeg pkgconf`) |
| `openrip-audio` | started | Audio decode (any FFmpeg format → stereo float at a chosen rate, sample-accurate positioning) and the timeline mixer: CapCut's mute/hide rules, volume keyframes, fades, speed (resampled; time-stretch to come) |
| `openrip-playback` | started | `PreviewEngine`: project + time → composited frame, read back or rendered into an IOSurface for the app. Keeps decoders, stills and fonts cached; skips and reports missing media; shows phone video upright. Also a per-source `FrameServer` (newest request wins; accurate and scrub seeks, CapCut-style) |
| `openrip-render` | started | wgpu compositor reproducing CapCut's measured image pipeline (sharpened area downscale / bilinear upscale, then Catmull-Rom placement, 8-bit canvas). Matches the reference model to ±1 code value and CapCut's exports at the model's PSNR. Hardware video frames are used in place: IOSurface NV12/P010 planes become textures with no copy, and YUV→RGB runs on the GPU |
| `openrip-node` | started | napi addon for Electron: `openProject` (CapCut draft / OpenRip JSON / v1), `renderFrame` (async, IOSurface handle for `sharedTexture`), `release`, `renderImage`. See `spikes/engine-preview` |
| `openrip-export` | started | Export: GPU composite straight into NV12 IOSurfaces, VideoToolbox H.264/HEVC via FFmpeg hardware frames, AAC-LC 44.1 kHz audio from the mixer, MP4 mux. Matches CapCut's export at 57–64 dB on stills |
| `openrip-dev` | started | Developer CLI (`capcut-import`, `capcut-scan`, `v1-import`, `v1-scan`, `probe`, `decode-bench`, `scrub-bench`, `play-bench`, `render-frame`, `preview-scan`, `export`, `mix`) |

```bash
cd engine
cargo test
OPENRIP_FUZZ_SEEDS=2000 cargo test --release -p openrip-model random_edit   # long randomized undo/redo run
cargo run --release -p openrip-dev -- capcut-scan "$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft"
cargo run --release -p openrip-dev -- decode-bench <video>   # add --sw for software decode
```

The decode tests generate their fixtures with the `ffmpeg` CLI (barcoded frame numbers in H.264 with B-frames and open GOP, HEVC 8/10-bit, 29.97 fps, MPEG-TS, VFR, ProRes) and check every frame of every seek.
