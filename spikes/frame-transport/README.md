# Frame-transport spike

Question: can a native (Rust) engine get decoded/rendered video frames into an Electron (Chromium) UI fast enough for a CapCut-class editor, at 4K60 and 8K30, without copying pixels?

Answer on macOS: **yes**. Electron 44's experimental `sharedTexture` delivers hardware-decoded IOSurfaces to the renderer at full rate with sub-millisecond per-frame cost. Results and decision are in [ROADMAP.md §2.1](../../ROADMAP.md).

## What it does

- `native/` — Rust N-API addon (`napi-rs` + `objc2`):
  - AVFoundation hardware decode into IOSurface-backed `CVPixelBuffer`s (`nv12`, `p010le` or `bgra`), with a bounded pool and explicit `release(id)` so frames recycle only after Electron is done with them.
  - A layer-backed `NSView` overlay that shows IOSurfaces directly on a `CALayer` (the native-layer path).
- `main.cjs` — paces frames at the stream rate and delivers each via `sharedTexture.importSharedTexture` → `sendSharedTexture` (path 1) or `overlayPresent` (path 2). Prints one `RESULT:` JSON line.
- `renderer.html/js` — mock editor chrome around the preview; draws received `VideoFrame`s with WebGPU (`importExternalTexture`) or Canvas2D; moves a playhead every frame to keep the UI busy.

## Run

```bash
cd spikes/frame-transport
npm install
(cd native && cargo build --release && cp target/release/libft_native.dylib ../ft_native.node)

# test media (hardware encoders, a few seconds each)
mkdir -p media
ffmpeg -f lavfi -i testsrc2=size=3840x2160:rate=60:duration=20 -f lavfi -i sine=frequency=440:duration=20 -c:v hevc_videotoolbox -b:v 60M -tag:v hvc1 -c:a aac -shortest media/test-4k60-hevc.mp4
ffmpeg -f lavfi -i testsrc2=size=7680x4320:rate=30:duration=10 -c:v hevc_videotoolbox -b:v 120M -tag:v hvc1 media/test-8k30-hevc.mp4
ffmpeg -f lavfi -i testsrc2=size=3840x2160:rate=60:duration=60 -f lavfi -i sine=frequency=440:duration=60 -c:v hevc_videotoolbox -b:v 60M -tag:v hvc1 -c:a aac -shortest media/test-4k60-hevc-60s.mp4

./run.sh --mode=shared --file=media/test-4k60-hevc.mp4 --fmt=nv12            # sharedTexture + WebGPU
./run.sh --mode=shared --file=media/test-4k60-hevc.mp4 --fmt=nv12 --draw=canvas2d
./run.sh --mode=overlay --file=media/test-8k30-hevc.mp4 --fmt=nv12           # native CALayer above the web UI
./run.sh --mode=overlay-below --file=media/test-4k60-hevc.mp4 --fmt=nv12     # native CALayer under a transparent web UI
```

Raw results append to `results.jsonl` (git-ignored). `cpuPercent` in the summary comes from Electron's `getAppMetrics`, which divides by core count; for CapCut comparisons use `bench/sample-procs.mjs` (100% = one core) instead.

## Results (Apple M2 Max, macOS 27, Electron 44.7.2)

| Mode | Stream | Delivered | Drops | Main-thread cost p95 | Renderer receive p95 |
|---|---|---|---|---|---|
| sharedTexture → WebGPU | 4K60 HEVC nv12 | 60 fps | 0 | 0.58–0.78 ms | 0.37–0.58 ms |
| sharedTexture → WebGPU | 4K60 H.264 nv12 | 60 fps | 0 | 0.78 ms | 0.58 ms |
| sharedTexture → WebGPU | 8K30 HEVC nv12 | 30 fps | 0 | 0.71 ms | 0.56 ms |
| sharedTexture → WebGPU | 4K60 HEVC **bgra** | 58.2 fps | 14 | 0.80 ms | 0.71 ms |
| sharedTexture → Canvas2D | 4K60 HEVC nv12 | 60 fps | 0 | 0.49 ms | 0.50 ms |
| CALayer above web UI | 4K60 HEVC nv12 | 60 fps | 0 | 0.13 ms | — |
| CALayer below web UI | 4K60 HEVC nv12 | 60 fps | 0 | 0.16 ms | — |
| CALayer above web UI | 8K30 HEVC nv12 | 30 fps | 0 | 0.17 ms | — |

Whole-app cost measured externally (`bench/sample-procs.mjs --decoder`), 4K60 HEVC, sharedTexture → WebGPU: **~37% of one core** total (main 6%, GPU process 19%, renderer 9%, VideoToolbox decode service 3%), **~511 MB** resident.

Hardware decode headroom: AVFoundation decodes this 4K60 HEVC clip at ~664 fps (11× real time) when nothing is displayed.

## Caveats

- Decode + display only: no compositing, effects, audio or timeline model yet. Engine-rendered frames will travel the same path (an engine-owned IOSurface instead of a decoder one).
- `sharedTexture` is experimental in Electron; pin the Electron version and keep the CALayer path as a fallback.
- The spike runs with `nodeIntegration` and no context isolation; the production preload needs a check that the receiver works with `contextIsolation` on.
- Windows (DXGI NT handles) and Linux (dmabuf) are untested.
- Not measured: seek/scrub latency (AVAssetReader is not built for random access; the engine will use VideoToolbox/FFmpeg directly).
