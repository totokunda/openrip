# App smoke harness

Drives the built app (`npm run build` in `apps/app`) with Playwright on a throwaway profile:

```sh
node session.mjs <appDir> <outDir> <userDataDir> <clip> <step...>
# e.g. the standard clip:
node session.mjs ../.. out/std out/ud-std /path/to/IMG_9019.MOV import timeline play perf
# a CapCut draft (its home-screen card text contains CAPCUT_DRAFT):
CAPCUT_DRAFT=… node session.mjs ../.. out/cc out/ud-cc x capcut perf
```

- Use a fresh `userDataDir` per run; `out/` is ignored by git.
- `OPENRIP_TRACE=1` logs the engine's sync, frame and decode timings to `logs.txt`; `OPENRIP_ENGINE_MUTE=1` silences playback.
- `EXE=<binary>` runs a packaged build.
- Screenshots are at 2x: CSS coordinates are half their pixels.
- Steps: `import`, `timeline`, `play`, `perf` (seek, scrub, playback, edit latency), `profstart`/`profstop` (renderer CPU profile), `capcut`, `selcaption`, `capstyle`, `capanim`. Helpers for new steps are in `steps/_preview.mjs`.
- Clicking the ruler seeks; draft-specific coordinates come from env vars (see each step).
