# Plan: a new timeline

Status 2026-10-31: the new timeline is built behind Settings › Edit › New timeline (Labs) and passes the timeline smoke suites. The user asked for the timeline to be rewritten so it works the way CapCut's does. They found the current React-Konva timeline janky and full of bugs.

**Progress (branch `timeline2`):**
- **Phases 1–4 are in.** That covers:
  - the core, view, layout and canvas;
  - gestures: moves with followers and ⌥-copy, trims, marquee, scrub, blade, edge scroll, Esc;
  - thumbnails and waveforms from caches;
  - transitions, keyframes, markers, range, render bar, Cover tile, scrollbars and the volume line;
  - drops from every panel and from panel windows;
  - shared context menus and double-click.
- **On the new timeline these pass:** every `tl-suite.mjs` case (magnet, link, snap, markers, tracks, handle, keys, tools, pinned, linkage, menus, undo, feel), plus groups, timelines, zoomrange, menus, compound, beatsui, windows, play and perf.
- **Phase 5 is next.** The nightly run (`scripts/smoke/nightly.mjs`) checks the rest on both timelines; then the new one becomes the default and the old one is deleted.

## Why the current timeline is janky

An inventory of the current code (2026-10-31) found these causes.

- **Drags live in React.** A clip drag is held in about fifteen places: React state in each clip component (`draggedPosition`, `tempClipPosition`, `resizeSide`, refs) and transient fields in the document store (`ghostX`, `ghostTimelineId`, `mainPreview`, `dragFollow`, `snapGuideX` and others).
  - Each pointer move makes six to eight store writes, and each write re-renders the ghost, the transition markers and the editor.
  - What a drag shows is worked out separately from what the drop does, so the two can disagree. That disagreement is the bug class the user keeps hitting.
- **Trims write the document on every mouse move.** Each write runs `resolveOverlaps`, which copies every clip. That defeats reference equality, so the engine resyncs and history compares everything again.
- **One 2,700-line clip component.** It mixes drawing, drag and drop geometry, trimming, menu construction and thumbnail scheduling.
  - Every clip subscribes to the visible window, so a scroll re-renders every clip and starts every video's thumbnail generation again.
- **Duplicated geometry.** The frame↔pixel mapping is written out again in about a dozen places, and the gap search five times. The ruler and track top are hard-coded as 18, 24, 27 or 32 depending on the file.
- **No tests for the rules.** The core editing rules (main-track packing, insertion, snapping, trim limits, overlap resolution) have no unit tests. They live in `clip.ts`, which imports the stores and so can't load in `node --test`. Only smoke tests cover them.

## What changes and what stays

**Stays:**
- The project format: the clips and tracks in `lib/types.ts`, saved as µs ticks.
- The clip store's document and its public actions, which 150 files use.
- The engine sync, autosave, undo (one step per press, per timeline) and compound navigation.
- The DOM toolbar (`Controls.tsx`, `TimelineTools.tsx`), the context-menu system, the marker editor and the keyframe graph panel.

The engine, inspector, export and history don't notice the rewrite.

**Replaced:**
- Everything under `components/timeline/` that draws or handles pointer input on the timeline (TimelineEditor, Timeline, TimelineClip and its parts, Scrubber, Scrollbar, the ghost, transition markers, waveforms on clips, the volume line, clip keyframes).
- The drag fields in the clip store.
- The scattered layout helpers (`trackView`, `getClipX`, `frameAtStageX` and their copies).

## Architecture

```
lib/timeline/core/      pure editing rules: no stores, no DOM, fully unit-tested
lib/timeline/view.ts    the view: pixels per frame, scroll, zoom; the one frame↔pixel mapping
lib/timeline/layout.ts  (document, view, size) → where every track, clip, band and handle is
lib/timeline/gesture/   the pointer state machine: press → gesture → preview → commit
components/timeline2/   one canvas surface drawn imperatively, and the DOM shell around it
```

1. **The editing core (`lib/timeline/core`).** Pure functions from a document and an edit to a new document. CapCut's notes say the same: ripple, magnet and linkage are model transforms, not UI logic.
   - Edits: move clips (along a track, to another track, to a new track, inserted on the magnetic main track, with followers), trim edges (one or several clips, ripple on the main track, limited by media, by neighbours and by a minimum length), split, delete with ripple, delete left and right, close gaps, duplicate.
   - Rules applied once at the end of each edit instead of after every write: clips on a track never overlap, the main track is packed when the magnet is on, and emptied tracks go away.
   - Snapping: an index of the playhead, markers, clip edges and beats, and the nearest point within a tolerance.
   - Every CapCut behaviour below gets a unit test here. The existing pure helpers (`packMainTrack`, `insertionFrame`, `mainTrackPreview`, `closeGaps`, `snapPoints`, `bundle.ts`, `linkage.ts`) move in.
   - It's TypeScript for now, written so it could move into the Rust engine (for mobile and web) without changing what it does.
2. **One view and one layout.**
   - The view is pixels per frame, a scroll position in frames and a vertical scroll. It also handles zoom anchored at the pointer or playhead, fit, and limits from about 30 s majors down to single frames.
   - The layout takes the document, the view and the canvas size, and returns every rectangle: track rows (with the pinned main track), clips and their bands, label chips, trim handles, transition badges, keyframe diamonds, markers and the ruler.
   - Drawing and hit-testing both read the layout, so what you see is what you click.
3. **Gestures.** A single controller owns pointer input on the timeline.
   - A press hit-tests the layout and starts a gesture: seek, scrub the playhead, pan the ruler, move clips, trim, marquee, blade, transition duration, keyframe drag, volume line, marker drag, range edge, or a drop from a panel.
   - Each pointer move asks the core for the result of the edit from the document as it was at the press. That result is the preview: the documents the canvas draws, plus the ghost, snap guide and new-track line.
   - Release commits the preview to the store in one write, so it's one undo step and exactly what was shown. Esc cancels.
   - Edge auto-scroll keeps working, and nothing renders through React during a drag.
4. **The canvas surface (`components/timeline2`).**
   - One dominant canvas, DPR-aware, redrawn in an animation frame only when something changed. Layers: ruler, track bands, clips, overlays.
   - The playhead and skim line go on a small overlay canvas, so playback redraws a line, not the timeline.
   - Thumbnails and waveforms come from caches: tiles per asset and time at the tile height, kept as bitmaps; waveform peaks from the engine as now. They're filled in the background and drawn when ready.
   - Track headers stay DOM beside it, as do the toolbar, menus, marker editor and keyframe graph.
   - Input listeners go on the canvas, `window` and `document` only, which the pop-out window mirroring relies on.
5. **A test hook in place of Konva queries.** `window.__openripTimeline` returns the layout (track rows, clip rectangles, handles, chips, waveform facts, diamonds, markers, transitions) and the view mapping.
   - The smoke helpers (`rowY`, `handleX`, `bar`, `rulerMap`, the Konva `find` calls) move onto it, so they stop depending on pixel colours and magic offsets.

## CapCut behaviours to match

These come from the CapCut UI spec (§4.9–4.12, §6.26–6.27), the CapCut inventory (§2) and the reference screenshots. Every row of the current inventory stays; the rows marked **new** are gaps today.

- **Selection.**
  - Click selects only that clip; Shift-click adds or removes it; **new:** ⌘-click toggles too.
  - **New:** drag on empty track space draws a marquee that selects every clip it touches.
  - Clicking empty track space deselects and moves the playhead there.
  - A group selects whole; locked tracks can't be selected.
- **Moving.**
  - What you drag is what lands: the clip and every follower (the others selected, linked clips with linkage on, group mates) are drawn where they'll go, and the drop puts them there.
  - Main track with the magnet on: the other clips open a gap at the insertion point (before or after the clip under the pointer), and the track closes up behind a clip dragged off it.
  - Overlay tracks are free: no overlap on drop.
  - A thin line between tracks or above the top one makes a new track of the clip's kind. A video track never goes under the main track.
  - Snapping to the playhead, markers, clip edges and beats (N toggles it, ⌘ held skips it), with a guide line.
  - Auto-scroll at the edges.
  - **New:** ⌥-drag duplicates.
- **Trimming.**
  - Hovering a selected clip's edge shows the trim cursor anywhere within about 10 px inside it.
  - The edge follows the pointer from where the trim began, limited by the media, a minimum length and the neighbour on an overlay track.
  - On the main track with the magnet on, the clips after it ripple.
  - Snaps as moving does. Linked clips trim with it.
  - **New:** a duration tooltip while trimming, and trimming several selected clips together.
- **Split, delete, gaps.** ⌘B / ⌘⇧B / the blade (B); Delete with ripple on the main track; Q and W; close gap and close all gaps; Freeze; Reverse.
- **Tracks.** The main track is pinned below the overlays, which scroll. The rest is as today:
  - lock, hide and mute;
  - Short, Default and Tall heights, and the waveform size;
  - reorder by dragging a header;
  - the Cover tile;
  - empty tracks removed;
  - arrange layers.
- **Playhead and ruler.**
  - Click to seek; drag to scrub, snapping and with scrub audio.
  - Pan by dragging the ruler. **New:** pan with two-finger scroll before 0 and past the end, up to a margin.
  - The preview axis (skim).
  - MM:SS labels, switching to frame labels close up.
- **Zoom.** ⌘ + scroll and pinch around the pointer; the slider; ⌘= and ⌘−; fit (⇧Z), whose second press goes back. **New:** a continuous zoom that reaches single frames.
- **Decorations.**
  - Thumbnails tiled at the clip's aspect; the clip's own sound in a bottom band; audio waveforms with the volume line.
  - Label chips with name and duration; the speed badge; effect chips.
  - Keyframe diamonds; transition badges with their duration band; In/Out animation marks.
  - Beat dots; markers and the range; the render bar.
  - Deactivated hatching; missing media; the compound glyph and breadcrumb.
  - The empty-timeline drop zone.
- **Drops from panels.** Media, transitions, effects, presets, shapes, stickers, adjustment layers, stock, subprojects: each previewed the same way as a move.
- **Menus and keys.** Unchanged behaviour. The clip menu's 370 lines move out of the clip component into a menu builder.
- **Pop-out window, several timelines, compound clips.** Unchanged behaviour.

**Open questions for the user** (CapCut can't be driven from here, so these use the default shown until they're answered):
1. A clip dropped onto an occupied spot on an overlay track: CapCut probably moves it to a new track above. Today it slides into the nearest gap. Default: a new track above.
2. Trimming with several clips selected: CapCut probably trims only the clip whose edge you hold. Default: only that clip, and the others stay selected.
3. Can you trim an unselected clip's edge directly? Default: yes, which selects it.

## Performance targets

- A drag or trim redraws at the display's rate with 500 clips, without a React render per pointer move.
- Playback redraws only the playhead overlay.
- Scrolling and zooming generate no new thumbnails for tiles already cached.
- An edit's commit copies only the clips it changed, so the engine and history see unchanged clips by reference.

## Phases

Each phase merges to main behind Settings › Labs › "New timeline" (off by default), until the last one.

1. **Core and surface, read-only.**
   - The core with the current pure helpers moved in, and unit tests for packing, insertion, snapping, overlap and trim limits.
   - The view and the layout.
   - The canvas drawing tracks, clips (bodies, chips, a flat thumbnail colour), the ruler, the playhead and markers.
   - Zoom and scroll, and click to seek.
2. **Gestures.** Selection (click, Shift, ⌘, marquee), moving every variant, trimming every variant, the blade, the playhead drag, ruler pan, edge auto-scroll, cursors, and committing as one step. The core gets unit tests for every move and trim behaviour.
3. **Decorations.** Thumbnails and waveforms from caches, the volume line, keyframe diamonds, transitions, beats, the range, the render bar, the Cover tile, badges, hatching and missing media, compound clips and groups.
4. **Drops, menus, the rest.** Drops from every panel, the menu builder, track headers wired to the new layout, the pop-out window, several timelines, the preview axis and scrub audio.
5. **Tests, switch, delete.**
   - The smoke helpers move onto the test hook.
   - Every timeline suite (`tl-suite.mjs`, multisel, groups, compound, transitions, keyframes, beats, waveform, zoom range, windows, undo) passes on the new timeline.
   - Then it becomes the default, and the old timeline (about 9,000 lines) and the store's drag fields are deleted.
