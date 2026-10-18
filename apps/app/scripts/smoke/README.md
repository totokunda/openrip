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
- Steps: `import`, `timeline`, `play`, `perf` (seek, scrub, playback, edit latency), `profstart`/`profstop` (renderer CPU profile), `capcut`, `capfolder` (a draft folder anywhere, `CAPCUT_FOLDER`), `seek`, `selcaption`, `capstyle`, `capanim`, `capbox` (a caption's box after a case and font change), `capadjust` (the draft's own adjustments in the Adjust tab), `capcolour` (clarity, vignette, fade, an HSL range and curves in the Adjust tab, on a clip that has them all), `capsticker` (a sticker drawn, and its opacity in the Filter tab), `capfilter` (a CapCut filter bar's intensity). Helpers for new steps are in `steps/_preview.mjs`.
- Keyframes: `keyframes` (after `import timeline`): keys set through the store with `lib/keyframes.ts` on the clip (opacity and position), the engine's frames checked over time, CapCut's edit-at-the-playhead rule, a split, and the saved project; `keyframescheck` (after `reopen`): the keys come back from the file and the engine draws them. Both import the renderer's modules, so they need its dev server: `npx vite --port 5199` in `packages/renderer`, and the session run with `MODE=development VITE_DEV_SERVER_URL=http://localhost:5199` (and `CLIP_NAME` for a clip other than IMG_9019).
- Transitions and clip animations: `transitions` (after `import timeline`, with the dev server as for `keyframes`): set through the store with `lib/animations.ts` on the clip split in two (its right half darkened): a Mix's frames across its window, a Push and a Wipe at the cut, Fade In and Fade Out, a split keeping the In on its left part with the frames unchanged, a Swing combo spanning its part, and the saved project.
- Undo: `undo` (after `import timeline newtext`: each kind of edit undone with ⌘Z and redone with ⇧⌘Z, the engine's frame and the saved project compared; then everything undone and redone by the toolbar), `capundo` (the same on a draft: a caption, a video, the timeline; `DRAFT_ADJUST` for the draft's own adjustments), `undoreopen` (after `reopen`: nothing left to undo). Helpers in `steps/_undo.mjs`.
- Clicking the ruler seeks; draft-specific coordinates come from env vars (see each step). Clicking the ruler also drops the selection, and a click on the playhead's line grabs the playhead, not the clip under it (6 px either side of it). `seek` (`_preview.mjs`) clicks the ruler once and steps the rest a frame at a time with ← / →, so it lands on the frame asked for.
- Steps print `PASS`/`FAIL` lines where they check something (`checks` in `steps/_anim.mjs`, with the Animation tab's helpers, the project as saved and where a clip's bar is).

## Timeline editing

`node tl-suite.mjs ../.. /path/to/clip [case...]` runs each case on a fresh profile under `out/tl/` (`CLIP_NAME` when the clip isn't IMG_9019; `TL_DRAFT` for the CapCut case). Every edit is undone and redone with the engine's frame and the saved project compared (`undoCase`); helpers in `steps/_timeline.mjs`.

- `tlmagnet` (after `import timeline`): ⌘B splits the main track's clip; ripple delete; the magnet toggled off (a delete keeps its gap) and on; Q and W; a clip dragged to the front of the main track goes in there; one dragged off it leaves it closed up.
- `tllink`: ⇧⌘S detaches the audio, linked (and the engine still draws the video); ⌘B cuts both; a trim, a move (magnet off) and a delete take the audio along; with linkage off (`) the video moves alone; Unlink.
- `tlsnap` (after `newtext`): the text's start snaps to the playhead (guide line drawn; not with N off), its end to a marker and to the video's end, a trimmed edge to the playhead.
- `tlmarkers`: M twice, tags under the ruler, ⌥← / ⌥→, the box's colour, name and time, a tag dragged (snapping), Delete, Delete all markers in timeline.
- `tltracks` (after `newtext`): + ▸ Audio track (it stays empty through other edits), lock (the clip can't be selected, deleted, moved or trimmed), a header dragged to the top, a video track can't go under the main track, Delete track (from the "…" menu, then a right-click, with its clip).
- `tlhandle` (after `newtext`): pressing a clip's trim handles changes nothing, and ⌘Z still undoes the edit before.
- `tlkeys` (after `newtext`): ← / → and ⇧→, Home / End, ↓ / ↑ between edits, Space, ⌘= (the timeline zooms, not the page) and ⇧Z, the playhead's handle let go staying on its frame at every zoom, ] and ⌘A.
- `tlcapcut` (after `capcut`): the draft's magnet from its config; ripple delete, Q, an insert and a detach on converted clips, drawn by the engine.

## Animation tab

`node anim-suite.mjs ../.. /path/to/IMG_9019.MOV [case...]` runs every case below, each on a fresh profile under `out/anim/`, and prints the checks. The CapCut cases take their drafts from `DRAFT_*` variables (what each needs is in the suite's header) and are skipped without them.

- The app's own clips: `newtext` (a text 0–3 s over the standard clip), `animtext` (each In animation hides the text at its start, shows part of it, then all; duration; None), `textcut` (a trim shorter than the animation, a split), `animvideo` (the clip split in two; White Flash, White Fade, duration, None; nothing after the last clip; no Blink; a split keeps the transition at its cut), `animundo`.
- Saving: `animsetup` (Type 1 on the text, White Flash at 5 s), `persist` and `persistcheck` (the tab's values and frames before and after `reopen`, which goes to a new project and back through the Projects menu, or after a restart), `quickset`/`quickcheck` (a change with nothing after it reaches the project file), `ticks` (a draft's clips keep the draft's timing).
- Drafts: `capin` (In animations shown, edited, replaced), `capkeep` (one the engine doesn't draw), `capwords` and `capwords2` (caption styles, an In animation on a caption, trims; a style the engine doesn't draw), `captrans`, `capblink`, `blinkapp` (Blink copied into the app's own project), `animtabs` (which clips get the tab), `capedit` (edits for `persist`), `capinfo` (writes the opened project's tracks and clips to `capinfo.txt`, for writing steps).
- `animexport`: an export through the engine, its frames checked with ffmpeg.
- `menuundo` (after `capcut selcaption`): Edit ▸ Undo and Redo chosen from the menu bar undo and redo the editor's edits.
