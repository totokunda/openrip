# App smoke harness

Drives the built app (`npm run build` in `apps/app`) with Playwright on a throwaway profile:

```sh
node session.mjs <appDir> <outDir> <userDataDir> <clip> <step...>
# e.g. the standard clip:
node session.mjs ../.. out/std out/ud-std /path/to/IMG_9019.MOV import timeline play perf
# a CapCut draft (the card named CAPCUT_DRAFT, else the first whose text contains it):
CAPCUT_DRAFT=… node session.mjs ../.. out/cc out/ud-cc x capcut perf
```

- Use a fresh `userDataDir` per run; `out/` is ignored by git.
- `OPENRIP_TRACE=1` logs the engine's sync, frame and decode timings to `logs.txt`; `OPENRIP_ENGINE_MUTE=1` silences playback.
- `EXE=<binary>` runs a packaged build.
- Screenshots are at 2x: CSS coordinates are half their pixels.
- Steps: `import`, `timeline`, `play`, `perf` (seek, scrub, playback, edit latency), `profstart`/`profstop` (renderer CPU profile), `capcut`, `capfolder` (a draft folder anywhere, `CAPCUT_FOLDER`), `seek`, `selcaption`, `capstyle`, `capanim`, `capbox` (a caption's box after a case and font change), `capadjust` (the draft's own adjustments in the Adjust tab), `capcolour` (clarity, vignette, fade, an HSL range and curves in the Adjust tab, on a clip that has them all), `capfilter` (a CapCut filter bar's intensity). Helpers for new steps are in `steps/_preview.mjs`.
- Undo: `undo` (after `import timeline newtext`: each kind of edit undone with ⌘Z and redone with ⇧⌘Z, the engine's frame and the saved project compared; then everything undone and redone by the toolbar), `capundo` (the same on a draft: a caption, a video, the timeline; `DRAFT_ADJUST` for the draft's own adjustments), `undoreopen` (after `reopen`: nothing left to undo). Helpers in `steps/_undo.mjs`.
- Clicking the ruler seeks; draft-specific coordinates come from env vars (see each step). Clicking the ruler also drops the selection, and a click on the playhead's line grabs the playhead, not the clip under it.
- Steps print `PASS`/`FAIL` lines where they check something (`checks` in `steps/_anim.mjs`, with the Animation tab's helpers, the project as saved and where a clip's bar is).

## Animation tab

`node anim-suite.mjs ../.. /path/to/IMG_9019.MOV [case...]` runs every case below, each on a fresh profile under `out/anim/`, and prints the checks. The CapCut cases take their drafts from `DRAFT_*` variables (what each needs is in the suite's header) and are skipped without them.

- The app's own clips: `newtext` (a text 0–3 s over the standard clip), `animtext` (each In animation hides the text at its start, shows part of it, then all; duration; None), `textcut` (a trim shorter than the animation, a split), `animvideo` (the clip split in two; White Flash, White Fade, duration, None; nothing after the last clip; no Blink; a split keeps the transition at its cut), `animundo`.
- Saving: `animsetup` (Type 1 on the text, White Flash at 5 s), `persist` and `persistcheck` (the tab's values and frames before and after `reopen`, which goes to a new project and back through the Projects menu, or after a restart), `quickset`/`quickcheck` (a change with nothing after it reaches the project file), `ticks` (a draft's clips keep the draft's timing).
- Drafts: `capin` (In animations shown, edited, replaced), `capkeep` (one the engine doesn't draw), `capwords` and `capwords2` (caption styles, an In animation on a caption, trims; a style the engine doesn't draw), `captrans`, `capblink`, `blinkapp` (Blink copied into the app's own project), `animtabs` (which clips get the tab), `capedit` (edits for `persist`), `capinfo` (writes the opened project's tracks and clips to `capinfo.txt`, for writing steps).
- `animexport`: an export through the engine, its frames checked with ffmpeg.
