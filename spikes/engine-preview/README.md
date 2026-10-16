# Engine preview spike

Plays a project through the Rust engine in an Electron window, with no copies: CapCut draft or OpenRip project → `openrip-node` addon → `PreviewEngine` (native VideoToolbox decode, wgpu compositor, swash text) → IOSurface → Electron `sharedTexture` → canvas.

```bash
./run.sh --project="$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft/<draft>" [--seconds=N] [--size=1280x720] [--mute]
```

Sound plays through the engine's `Player`: the mixer feeds cpal, and the samples actually played are the master clock. Each frame is rendered for the time on that clock, so the picture follows the sound.

`run.sh` builds the addon and runs Electron 44 from `../frame-transport` (`sharedTexture` needs 44; the app is still on 38). With `--seconds`, it quits after N seconds and appends stats to `results.jsonl`.

First runs (M2 Max, 2026-10-16):

| Project | Preview | Frames shown | Render p50 / p95 | sharedTexture send p50 |
|---|---|---|---|---|
| Calibration session 2 (1080p chart, 30 fps) | 1280×720 | 28.9 fps | 6.8 / 9.1 ms | 0.47 ms |
| A real phone draft (4K H.264 portrait, 24 fps) | 406×720 | 23.1 fps | 7.8 / 11.8 ms | 0.52 ms |
| Calibration session 1 with audio (muted), audio clock | 720×720 | 22.9 fps | 2.7 / 20.0 ms | 0.60 ms |

A/V sync on the session 1 run: the picture handed over trails the sound being heard by 0 ms at p50 and 21 ms at p95, inside the ±45 ms usually taken as lip-sync tolerance.

**Wired like the app will be** (since 2026-10-16):
- `contextIsolation` on, `nodeIntegration` off.
- `preload.cjs` receives the frames through `sharedTexture.setSharedTextureReceiver` and draws them into the page's canvas. The page gets only a stats function.
- The main process drives the render-ahead pipeline at the display rate: `setPreviewSize`, `startPlayback`, `frameForDisplay`, `release`.

| Project | Preview | Frames shown | Render p50 / p95 | A/V offset p50 / p95 |
|---|---|---|---|---|
| A real phone draft (4K H.264, PNG overlay, stroked caption), 24 fps, isolated | 406×720 | 23.9 fps (351 of 360 in 15 s, including start-up) | 7.2 / 12.7 ms | 9 / 20 ms |
