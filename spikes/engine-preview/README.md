# Engine preview spike

Plays a project through the Rust engine in an Electron window, with no copies: CapCut draft or OpenRip project → `openrip-node` addon → `PreviewEngine` (native VideoToolbox decode, wgpu compositor, swash text) → IOSurface → Electron `sharedTexture` → canvas.

```bash
./run.sh --project="$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft/<draft>" [--seconds=N] [--size=1280x720]
```

`run.sh` builds the addon and runs Electron 44 from `../frame-transport` (`sharedTexture` needs 44; the app is still on 38). With `--seconds`, it quits after N seconds and appends stats to `results.jsonl`.

First runs (M2 Max, 2026-10-16):

| Project | Preview | Frames shown | Render p50 / p95 | sharedTexture send p50 |
|---|---|---|---|---|
| Calibration session 2 (1080p chart, 30 fps) | 1280×720 | 28.9 fps | 6.8 / 9.1 ms | 0.47 ms |
| A real phone draft (4K H.264 portrait, 24 fps) | 406×720 | 23.1 fps | 7.8 / 11.8 ms | 0.52 ms |

Like the frame-transport spike, this runs with `nodeIntegration` and no context isolation. The app needs a preload bridge.
