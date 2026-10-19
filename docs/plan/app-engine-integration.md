# Plan: the app's preview on the Rust engine

Status 2026-10-16: the engine side is done and measured; the app runs on Electron 44 (step 1) and ships and loads the engine on Apple Silicon (step 2). `spikes/engine-preview` plays CapCut drafts in Electron 44 through `sharedTexture`, with sound and A/V sync. What remains is wiring it into `apps/app`. That changes the editor you use every day, so it is planned here and done together.

## Today's preview (survey of `apps/app`)

| Concern | Now | With the engine |
|---|---|---|
| Compositing | React-Konva canvas2D scene, one component per clip (`renderer/src/components/preview/Preview.tsx`, `clips/*Preview.tsx`); WebGL 1 filters round-trip through 2D canvases | One surface: frames composited by `openrip-render` (CapCut-calibrated) arrive as IOSurfaces |
| Video decode | WebCodecs `VideoDecoder` in workers, mediabunny demux (`lib/media/video-decoder*.ts`) | Native VideoToolbox in the engine (3–4× FFmpeg's hwaccel), frame-accurate seek, prefetch |
| Audio | One `AudioContext` per clip, soundtouch worklet for speed (`AudioPreview.tsx`) | One mixer and one output (`Player`); CapCut's mute/hide rules; pitch-preserving speed |
| Clock | `requestAnimationFrame` loop in `useControlsStore` (`lib/control.ts`, `__playbackTick`) | The audio clock: samples actually played |
| Process / bridge | `contextIsolation: true`; preload exposes modules with `contextBridge`; no native addons | The `openrip-node` addon in the main process; the preload exposes a small preview API |
| Electron | 38.7.2 | 44 (`sharedTexture`) |

Konva stays for everything drawn over the picture: transform handles, masks, drawing, lasso, cursors.

## Steps (each one shippable, behind a setting until parity)

1. **Electron 38 → 44.**
   - Bump, rebuild, and run the existing smoke tests (Playwright Electron recipe) and a manual pass.
   - No native modules are involved, so the risk is Chromium/API changes in our code.
2. **Ship the addon.** Done for Apple Silicon (2026-10-16).
   - `scripts/build-engine.mjs` builds `openrip-node` into `native/<platform>-<arch>/` (run by `npm start` and `npm run build`); electron-builder packs it into `resources/engine/`.
   - The main process loads it (`modules/EngineModule.ts`); the preload's `engineInfo()` tells the UI whether it's there and its version. Without it the app runs on its own preview.
   - Checked: dev mode and a packaged `OpenRip.app` (arm64, unsigned) both load it; with it missing, the app imports, plays and edits as before.
   - FFmpeg is linked in statically (2026-10-16): `engine/scripts/build-ffmpeg.sh` builds FFmpeg 9.0.2 (the version the bindings target; tarball checked against its release signature) as static LGPL libraries with only the demuxers, decoders, encoders, parsers and filters the engine uses, into `engine/.ffmpeg/<arch>/`. `build-engine.mjs` runs it once per architecture, builds the addon with the `static-ffmpeg` feature in its own target dir (`engine/target/addon`), and fails if the addon links anything outside `/usr/lib` and `/System`, or leaves a compiler builtin undefined. Before, the addon loaded Homebrew's FFmpeg from `/opt/homebrew`, so it only worked on Macs that had it, and Homebrew's build carries GPL encoders.
   - Napi addons link with `-undefined dynamic_lookup`, so a missing symbol fails only when called: FFmpeg's `__builtin_available` checks need compiler-rt (`libclang_rt.osx.a`), which rustc doesn't link; without it the addon crashed on the first VideoToolbox frame.
   - Static LGPL linking is allowed because the app's source is public (LGPL's relinking terms).
   - Intel: `node scripts/build-engine.mjs --arch x64` cross-builds FFmpeg and the addon. Without `nasm` installed, FFmpeg's x86 assembly is left out (software decoding is slower; VideoToolbox decodes H.264, HEVC and ProRes either way). On x86_64, FFmpeg's AVFoundation link pulls in the Swift CoreMedia overlay, which macOS keeps in `/usr/lib/swift`; the addon gets an rpath there. It builds and links with nothing outside the system, but hasn't run yet: this Mac has no Rosetta.
   - Checked: the app with the static addon imports the ProRes clip, draws shapes, text and adjustments, plays at 1.00× and exports in 4.2 s; the dev tool built the same way gives identical results to the Homebrew build on all 12 CapCut exports and 31 draft covers, so the minimal FFmpeg covers the drafts' media. A packaged, unsigned `OpenRip.app` (arm64) loads it from `Resources/engine/`, draws with it by default, plays and exports (3.2 s for the 10 s clip).
3. **Project in, kept in sync.** Done (2026-10-16), behind Settings → Engine → "Use the Rust engine for the preview".
   - `lib/engine-preview.ts` sends the autosave's snapshot (`getActiveProjectJsonSnapshot`) to the main process 60 ms after an edit (`engine:sync-project`): opened once, then `updateProject`. An edit shows in the engine's frame at once.
   - The renderer already autosaves v1 JSON (`withJsonProjectPersistence`), and `openrip-v1` imports it in 1–2 ms.
   - First cut: send the project on load with `openProjectJson(json)` and after each edit (debounced) with `updateProject(json)`, which keeps decoders warm.
   - Later: send `openrip-model` `Edit` commands instead of whole projects.
4. **Preview surface.** Done (2026-10-16), first cut.
   - `components/preview/EngineFrame.tsx` asks for the frame at the playhead at its on-screen size (`engine:render`; the newest request wins), and draws the canvas the preload paints the shared texture into, under the clips.
   - Video, image, text, shape and drawing clips stop decoding and drawing in engine mode but keep their handles (text shows again while it's typed; an eraser stroke's live result shows until it's kept). Masks are drawn by the engine too ([masks.md](../parity/masks.md)); while the mask tool is out the engine gets the project without them, as the old preview showed clips unmasked then.
   - Checked in the app with a 10 s iPhone ProRes clip: frames arrive, scrubbing and moving a clip update the engine's picture, playback on the old clock gets 23.6 of 24 fps from the engine, and turning it off brings the old preview back.
   - Shapes and drawings are drawn by the engine since 2026-10-16 (`openrip-render::shape`, Konva's geometry for rectangles, ellipses, rounded polygons, stars and tensioned lines). In the app all five shapes and a brush and a highlighter stroke match Konva's to 1.8 levels on average, the rest being the video's resampling. The app's drawing tools name a blend each (multiply for the highlighter) but never hand it to Konva, so the engine draws every line normally too; it can multiply a layer if that's ever wanted.
   - Text lines are placed as Konva places them with `_fixTextRendering` (which the app turns on): 1-em line boxes, each baseline half the difference of Chromium's font-box ascent and descent below the box's middle. Chromium's font box is the hhea ascent and descent, with 15% more ascent for Times, Helvetica and Courier on macOS (measured in Electron on six system fonts). The engine's text now sits within 0.25 px of Konva's at a 48 px em; it had sat 0.1 em off.
   - The clip adjustments (brightness, contrast, hue, saturation, blur, sharpness, noise, vignette) are drawn by the engine as the app's WebGL filters draw them, in its order, after the masks; pixel distances are the app's world units (its working canvas is the clip fitted to a 600-unit-tall world). With all but noise set, the engine's preview matches the old one to 1.9 levels on average; noise is fresh random grain on both, so it can't match pixel for pixel.
   - Grouped clips stack where their group sits, the group's first child on top, and the group's track hides or mutes them, as `lib/clipOrdering.ts` orders them.
   - Gaps against the old preview: mask lassos saved as binary files (`lassoPointsBinPath`) aren't read when a project file is imported directly (the app sends its hydrated points). Filters from the Filters panel (Hald CLUT images) are drawn since 2026-10-16: read as ImageMagick does (edge-aligned, trilinear) and mixed by intensity; the app's own preview and the engine's agree to 0.7 levels on average.
   - Add `EnginePreview.tsx`: one canvas (or a `<video>` fed by `MediaStreamTrackGenerator`, cheaper per the spike) that draws frames received through `sharedTexture.setSharedTextureReceiver`.
   - It replaces the clip-mapping block in `Preview.tsx` and `FullscreenPreview.tsx`. Overlays stay.
   - **Verified:** `spikes/engine-preview` now runs exactly this way: `contextIsolation` on, the preload receives the frames and draws them into the page's canvas (the preload world shares the DOM, so no `VideoFrame` crosses `contextBridge`). A real draft plays at 23.9 of 24 fps.
5. **Playback and scrubbing.** Done (2026-10-16) in engine mode.
   - Play starts the engine's playback (`engine:play`): it plays the mixed sound and renders ahead of its audio clock; each display tick main sends the frame due now and its time (`engine:clock`), which moves the playhead. Pause stops it where the sound stopped; at the end it stops (`engine:ended`). Runs carry a token so ticks from a stopped run are dropped.
   - The app's frame timer gives way through a `PlaybackDriver` hook in `lib/control.ts`; the per-clip audio players aren't mounted in engine mode.
   - The engine gets original files: `engineSourcePaths` maps proxies and playable copies back to them before each sync, so iPhone ProRes plays from the original (hardware decode, 414 fps on a 1080p clip).
   - Checked: the playhead follows at 0.99x real time with 72 frames in 3 s (24 fps), pause holds, playing on after a seek stops at the end, and switching back to the old player works.
   - No playable copy when the engine draws (2026-10-16): a video the app's own decoder can't read (ProRes) keeps its track in the media info for its size and rate (`videoDecodable: false`), and the app's frame fetching (`lib/media/canvas.ts`, `video.ts`) gets its frames from the engine's thumbnailer (`engine:thumbnails`, exact frames, cached on disk) through a stand-in for mediabunny's `CanvasSink`. Importing the standard ProRes clip no longer converts it, and its timeline strip comes from the engine. Without the engine the copy is made as before.
   - Main runs the `PreviewPipeline` (render-ahead).
   - On each display tick it takes the frame for the `Player` clock and sends it.
   - It pushes the clock to the renderer, which sets `focusFrame` from it in place of `__playbackTick`.
   - Seeks and scrubs go to `pipeline.seek` (newest wins). The per-clip `AudioContext`s go.
6. **Export.** Done (2026-10-16) in engine mode.
   - With the engine preview on, H.264/HEVC video in MP4, MOV or MKV without alpha goes through `openrip-export` (GPU compositing → VideoToolbox, the engine's mix as AAC 44.1 kHz): `exportProject` on a worker thread, `exportProgress` polled by main every 200 ms (`engine:export-progress`), `cancelExport` from the dialog's cancel. It exports the same snapshot the preview gets, with original media.
   - WebM, VP9/AV1/ProRes, alpha and stills stay on the app's exporter.
   - Checked in the app: a 10 s 1080P export of the standard clip in 2.3 s, H.264 + AAC, 10.04 s long.
   - The resolution now sets the short side for both exporters (1080P portrait is 1080×1920, as in CapCut); it had set the height, so portrait came out 608×1080.
7. **The engine by default.** Done (2026-10-16): the setting is on unless the user turned it off, now that the engine draws everything the old preview did (video, photos, text, shapes, drawings, masks, the Filters panel's LUTs, clip adjustments, groups). Checked on a fresh profile: the engine draws from the start, the setting turns it off and on, and a 10 s 1080P export with shapes, drawings, text and adjustments takes 4.2 s.
8. **Remove the old path**: the clip components' own drawing and decoding, the WebGL filters and masks, the old exporter for what the engine exports, and the media panel's old thumbnails and probe (so a ProRes file needs no playable copy). Keep it until the engine has run as the default for a while.

## CapCut projects in the app

Done (2026-10-16): Projects ▸ Open CapCut Project… lists the drafts CapCut shows on its home screen (with their covers), or takes a draft folder, and makes a new OpenRip project from it. The draft is only read.

- **How a draft becomes an app project.** The engine imports the draft into its model and writes the app's own project format (`openrip-v1` `to_app_project`, addon `capcutToApp`): tracks in CapCut's stacking order (sound at the bottom), clips the editor knows (video, image, audio, text; effects, filters, stickers and adjustment layers as named filter clips), a box around each text where the engine lays it out, and the draft's exact canvas as the aspect ratio. Media are linked into the project's media folder, as the app's own imports are, and CapCut's cover becomes the project's.
- **What the engine keeps.** Each clip also carries the CapCut segment it came from, the materials that segment uses, and its own fields as written (`engine` on the clip). When the app sends the project back, the importer rebuilds the segment and applies on top only what the app changed: a move, resize or turn (applied to CapCut's own transform, keyframes included), a trim or retime, opacity, volume, a new text, size or colour (on a copy of the text for that clip). Caption styles, animations, effects, masks, transitions, voice effects, background removal and exact timing stay as CapCut had them. A clip split in the app keeps the payload in both halves; its clip id tells them apart.
- **Checks.** Every local draft with its media (36) converted to the app's format and back draws exactly the same frames as the draft itself (`openrip-dev app-roundtrip`); the one that didn't had lost CapCut's saved background removal, which the importer now keeps on the app's asset. In the app, a draft opens in about 5 s, plays, and its 56 s export takes 10 s and matches CapCut's own export at 40.7 dB (median, 540×960). Dragging a clip moves it in the engine's picture.
- **The panels edit CapCut clips** (2026-10-17). A converted clip also carries the panel fields for what the draft has, and the importer applies a change to any of them on top of the draft's segment:
  - **Text:** font, bold, italic, underline, alignment, letter case, stroke, shadow and background, with sizes as fractions of the font size, as for the app's own text. A CapCut background keeps its padding and rounding when its colour changes.
  - **Adjust:** the sliders go on top of CapCut's own adjustments and start at zero.
  - **Masks:** the app's masks go on top of CapCut's.
  - **Audio:** fades replace the draft's.
  - Numbers compare by value (the app writes 3 for 3.0), and a project converted before a field existed treats that field as unchanged.
- **Animation tab** (2026-10-17), for the app's own clips and CapCut's alike:
  - **Text:** the In animations the engine draws (Type 1, Type 2, Typewriter) with their duration. Captions with spoken-word timing also get a style: whole text, three words with the spoken one highlighted, or one word at a time.
  - **Video and photos:** the transition into the next clip on the track (White Flash, White Fade, and Blink when the project has CapCut's image sequence for it), with its duration.
  - A draft's animation, caption style or transition the engine doesn't draw is listed by name and kept until replaced.
  - These are the ones the local drafts use: In animations 47 times in 22 drafts, caption styles 43 times in 6, transitions 8 times in 2; no draft animates video or photos.
  - **Split and trim** (2026-10-17): a split leaves a text's In animation on the first half and a transition on the second (the half that ends at the next clip), for the app's own clips and CapCut's. An In animation longer than its clip, after a trim, ends with the clip. A caption's style covers the whole clip after a trim, and its words keep time with the speech when a split or a trim cuts off its start (`spokenFrom` on the clip, the caption animation starting before the clip in the engine).
  - A transition is drawn only at a cut, where the next clip on the track starts as its own clip ends; without one, the tab says so and nothing is drawn. Its duration is at most 2 s and within both clips. Blink stays on offer while any clip, or a draft's own materials, has CapCut's image sequence.
  - **Saving:** a change in the tab (or any other panel) is saved within half a second; before, only a change of timing or placement was saved by itself. Opening a project no longer brings clips back a frame early: ticks are truncated to whole µs and were truncated again into frames, so most of a draft's clips (and its transitions with them) moved a frame on every open.
  - The tab's changes undo like any other edit ([Undo and redo](#undo-and-redo)).
- **The draft's own adjustments, filters and text boxes** (2026-10-17):
  - **Adjust tab:** a video or photo lists what the draft put on it, under "From the CapCut draft" (`draftAdjustments` on the clip, by material). CapCut's Adjust sliders and the colour wheels' strength, which the engine draws, are sliders on CapCut's scale (−50…50; sharpen 0…100; the wheels in percent). Log wheels and any filter or effect on the clip are listed by name as not drawn yet (clarity, vignette, fade, HSL and curves were drawn later the same day; see below). Each can be taken off the clip, an edited one goes back to the draft's value, and the header puts back all of the draft's. An edit goes on a copy of the draft's material for that clip. The app's own sliders still go on top. In the local drafts, CapCut's sliders are on 79 clips in 5 drafts and colour wheels on 26 clips in 1; HSL and curves that change nothing (within a level) aren't listed, which leaves one clip with HSL.
  - **Filter bars:** a CapCut filter on its own track gets the Filter tab's intensity, set to the draft's strength; it sets the strength the engine mixes the filter's table in by. Effects and adjustment layers say the engine doesn't draw them yet (stickers were drawn later the same day).
  - **Text box:** when an edit changes a CapCut text's words or style (font, case, size, bold…), `updateProject` lays it out again and returns its block (`textBlocks`), and the app's box takes the block's size about the same middle. The importer places CapCut text by the middle of its box, so the box can change size without moving the text.
  - **Case:** the Text tab's case buttons rewrite the words in the new case; the importer treats that as a case change, so a caption keeps its spoken-word timing and caption style.
  - Checked in the app: on the calibration draft with one Adjust slider per clip, brightness from −25 to 40 lightens the engine's frame (mean 0.100 → 0.165), removing it gives the plain picture, and putting the draft's back gives the same frame as before; on a draft with colour wheels, their strength at 0% darkens the frame from 0.571 to 0.510. On a draft with two filter tracks (media paths pointed at the offload volume, opened from a folder), the top filter at 0% and at 100% both change the frame, and its clips list eight sliders (two not drawn). Uppercasing the small draft's caption widens its box from 128 to 147 px, Georgia narrows it to 124 px, and its middle stays put; a word-timed caption keeps showing a page of three words after uppercasing. Harness steps: `capadjust`, `capfilter`, `capbox`, `capfolder`, `seek`.
- **More of the draft drawn and editable** (2026-10-17):
  - **Adjust tab:** clarity, vignette and fade are drawn and are sliders on CapCut's 0…100 ([colour.md](../parity/colour.md)). Each HSL range is drawn, with hue, saturation and lightness sliders on −100…100 (`values` in its `draftAdjustments` entry). Curves are drawn and can be taken off; CapCut edits them on a curve, so they have no slider.
  - **Sticker bars:** PNG and GIF stickers are drawn ([stickers.md](../parity/stickers.md)), and the Filter tab's slider is their opacity.
  - Checked in the app with the harness steps `capcolour` and `capsticker`.
    - Each new slider changes the engine's frame; the HSL saturation moves it; taking the curves off changes it; putting the draft's back restores the first frame.
    - A sticker is drawn, and its opacity at 30% fades it.
- **Still CapCut's alone:**
  - the draft's masks aren't shown in the panels, nor the keys of the properties `keyframes` doesn't cover (below);
  - video effects aren't drawn: the one local use's bundle isn't in CapCut's cache;
  - adjustment layers and log wheels aren't drawn (no local draft uses either);
  - CapCut's AI colour match and correction can't be drawn without its models;
  - a sticker's size at scale 1 is unchecked against CapCut.

  None of these have settings yet.

## Keyframes

Done (2026-10-18): the data model and the engine. The keyframe diamonds, the inspector's navigators and the keyframe graph are UI still to build on it ([keyframes.md](../parity/keyframes.md) has the engine side and how CapCut's curve was matched).

The inspector's navigators are built (2026-10-18), on the video and photo panels: `KeyframeButton` in `PropertyRow`, `PropertiesSlider` and section headers (one property or a section's several), lib/keyframe-ui.ts (`useKeyedProperty`, `toggleKeysInStore`, and `useShownTransform` / `setShownTransform` for the clip's handles on the canvas) over pure edits in lib/inspector-edits.ts (`editProperties`, `keyNavOf`, `toggleKeys`, `transformAt`; `tests/inspector.test.ts`). A mask's poses are keyed the same way through lib/mask-shapes.ts. The timeline's diamonds and graph are still to build. Checked with `insp-suite.mjs` (scripts/smoke/README.md).

- **On a clip.** `keyframes` (`lib/types.ts`) maps a property to its keys, sorted by frame. Each key is `{ frame, value, ease? }`:
  - `frame` is clip-local: 0 is where the clip starts on the timeline, at the project's rate. It can be fractional, so a CapCut key keeps its exact µs.
  - `value` is in the clip field's own units. `position` is the box's centre in world units (y down; the transform's `x`/`y` are its turned top-left corner). `scale` is `[scaleX, scaleY]`, `rotation` degrees about the centre, `opacity` 0–100 and `volume` dB. Then the Adjust sliders on their scale, `intensity` for a filter bar (a sticker bar's opacity), a text's `color` (`#rrggbb`), `fontSize`, `stroke`, `strokeWidth`, `strokeOpacity`, `shadowColor`, `shadowOpacity`, `shadowBlur`, `backgroundColor` and `backgroundOpacity`. And `draft:<id>` for one of a converted clip's `draftAdjustments` (CapCut's scale), or `draft:<id>:hue` (`:saturation`, `:lightness`) for an HSL range.
  - `ease` shapes the span to the next key. It's `"linear"` (the default) or `"hold"`, or CapCut's graph presets `"easeIn"`, `"easeOut"` and `"easeInOut"`: CapCut's curve with its default handles (0.4 of the span, flat) leaving this key, arriving at the next, or both. Or it's a custom curve `{ out: {frames, value}, in: {frames, value}, straight? }`: the handles as offsets from this key and from the next, in frames and the property's units, one number for all components or one per component.
  - While a property has keys, they decide its value and the field's own value is ignored, as in CapCut.
- **Helpers** (`lib/keyframes.ts`, pure: each returns new objects, never writing to what it's given, since the undo history shares clips between states):
  - read: `listKeyframes`, `hasKeyframes`, `keyframeAt`, `previousKeyframe`/`nextKeyframe` (the navigator's ‹ ›), `keyframeFrames` (every keyed frame, for the clip's diamonds), `keyframeableProperties`;
  - edit: `setKeyframe` (add or replace), `removeKeyframe`, `moveKeyframe`, `setKeyframeEase`, `clearKeyframes`;
  - sample: `sampleKeyframes(keys, frame, property, fps)` and `valueAt(clip, property, timelineFrame, fps)` (keys, else the field) compute values as the engine does: CapCut's curve and solver in f32, colours in 0–1 channels and volume as gain;
  - clip operations: `shiftKeyframes`, `scaleKeyframes` and `splitKeyframes`;
  - the edit rule: `editProperty(clip, property, timelineFrame, value)` returns the patch for `updateClip`. While the property has keys it sets the key at the playhead; otherwise it changes the field, and a turn or scale keeps the box's centre. `toggleKeyframe` is the diamond: a key with the value at the playhead, or none if there was one. `propertyValue` gives a field's value in keyframe units.
- **The store.**
  - Keys stay on the content. A trim of a clip's start shifts them by minus the trim. A speed change from s0 to s1 scales them, and their handles, by s0/s1, and a frame-rate change by the ratio of the rates.
  - A split gives each half the keys on its side, plus one at the cut so the motion carries on. A curve is cut in two, as CapCut splits a keyframed clip.
  - Keys are plain JSON on the clip, so the autosave and undo keep them with no special handling.
- **To the engine.** The importer (`engine/crates/v1/src/keys.rs`) turns keys into the segment's: frames into µs, values into model units. Presets become CapCut's handles, and a custom curve's handle points convert like the values, so a curve keeps its shape through dB to gain.
- **CapCut clips.** `to_app_project` shows a converted clip's own keys in `keyframes`, for the properties above, and in `base`. When the project comes back, a property whose keys differ from `base` replaces the segment's keys for it; the others stay exactly CapCut's.
  - Keys the app doesn't show (a mask's, a text's shadow) stay on the media through a trim or speed change.
  - Unedited, a converted clip comes back exactly.
- **Masks.** A mask keyframe takes an `ease` too: poses of the same shape travel by it, linear by default. `featherAmount` (0–100, CapCut's) and `inverted` are drawn. A brush mask's strokes go in `brushStrokes`. See [masks.md](../parity/masks.md).
- **Checked:**
  - the unit tests in `tests/keyframes.test.ts` (`node --test`) and the v1 crate;
  - the harness steps `keyframes` and `keyframescheck`: keys set through the store change the engine's frames over time; CapCut's rule; a split; save and reopen;
  - opening a keyed draft in the app shows its texts' opacity keys in `keyframes`.

## Transitions and animations

Done (2026-10-18): the data model, the built-in lists and the engine ([transitions.md](../parity/transitions.md), [clip-animations.md](../parity/clip-animations.md)), and the UI on them: the Transitions tab (CapCut's grid by category; + or a card dragged onto a cut), the transition's marker on the cut and its inspector, and the Animation tab's In / Out / Combo (In / Out / Loop for text) grids of cards with the duration in the footer (`lib/transitions.ts`; docs/inventory/current-app.md §12, §13).

- **On a clip** (`lib/types.ts`):
  - video and image: `transitionOut`, `animationIn`, `animationOut`, `animationCombo`;
  - text: `animationIn`, `animationOut`, `animationLoop`.
  - An animation is `{ type, duration, name?, params? }`: `type` a built-in's id, or "" for a CapCut one the engine doesn't draw (kept as the draft had it until replaced; `name` is CapCut's). A transition is the same plus `resource` (Blink's image sequence). `params.direction` ("left", "right", "up", "down") goes with Slide, Push and Wipe, left when left out.
  - Durations are seconds. An In runs from the clip's start and an Out up to its end. The engine shortens an Out so it doesn't overlap the In, and ends an In or a Loop with the clip. A Combo always spans the whole clip, whatever its `duration`. A Loop repeats once per its duration. A transition runs across the cut, half on each side, at most the clip's length, and only where the next clip on the track starts as this one ends.
- **Built-in lists** (`lib/animations.ts`):
  - `TRANSITIONS` and `animationsFor(clipType, kind)` give each built-in's CapCut name, `type`, a category like CapCut's panels (Classic, Basic, Slide, Mask, Movement; Typing for text), `params` (with options and default), default duration and `capcut`: "bundle" when its behaviour comes from CapCut's own script, "named" when it's our curve for CapCut's name. Transitions also say whether they show both clips at once (`overlap`) and whether they need CapCut's bundle (`needsResource`, Blink).
  - Transitions: Mix, Black Fade, White Flash, White Fade, Pull in, Pull out, Blur, Blink, Slide, Push, Wipe, Circle, Spin.
  - Video and photo In: Fade In, Zoom In, Zoom Out, Slide, Rotate, Spin, Bounce, Shake. Out: Fade Out and the same moves. Combo: Swing, Shake, Pulse, Spin.
  - Text In: Type 1, Type 2, Typewriter, Fade In, Zoom In, Zoom Out, Slide. Out: Fade Out, Zoom In, Zoom Out, Slide. Loop: Pulse, Swing, Shake, Float, Blink.
  - Helpers, pure: `transitionOf(type, {duration, params, resource})` and `animationOf(clip, kind, type, {duration, params, fps})` make the field with defaults (a Combo spanning the clip). `maxAnimationDuration(clip, kind, fps)` and `maxTransitionDuration(clip, next, fps)` give the slider bounds the engine keeps to. `ANIMATION_FIELD` maps a kind to its field. Set the results with `updateClip`; undo and the autosave need nothing more.
- **The store:** a split keeps the In on the left half, the Out and the transition on the right, and the Combo or Loop on both.
- **To the engine** (`engine/crates/v1`): the fields become the segment's animations and transition. A direction joins the engine's name ("slide_left"); the overlapping transitions are marked so. CapCut clips show their own as these fields, and a field the app changes replaces the draft's of that kind; the rest stay CapCut's, and an unedited clip comes back exactly.
- **CapCut import:** by resource id where known (White Flash, White Fade, Blink, Pull in, Black Fade, the video Fade Out), else by English name (Mix, Black Fade, Pull in, Pull out, Fade In, Fade Out); others are listed in the import report's `unmapped_library`.
- **Checked:** `tests/animations.test.ts` (`node --test tests/*.test.ts` in packages/renderer) checks the lists against the engine's. Then the v1 crate's tests (fields both ways, the fitting rules, splits), the engine's tests (math and frames), and the harness step `transitions`.
- **The panels** take their lists from `lib/animations.ts` and show a draft's undrawn one by `name` (a card of its own, or the transition's inspector), kept until replaced. A transition goes on a cut only (the selected clip's end, or the cut before it when nothing follows); `lib/transitions.ts` has the cuts, the bounds, Apply to all and the selected transition (`selectedTransitionId`, controls store). Choosing a Combo takes the In and Out off and an In or Out takes the Combo off, as CapCut does.
- **Checked through the UI:** the harness steps `transui`, `animclip`, `animvideo`, `animtext` (README, motion-suite.mjs and anim-suite.mjs).

## Speed tools

Done (2026-10-18): the data model, the store operations and the engine for CapCut's Speed tab (Standard and Curve) and the toolbar's Freeze and Reverse ([speed.md](../parity/speed.md) has CapCut's maths and the checks), and the UI on them: the Speed tab (renderer/src/components/properties/SpeedProperties.tsx) and the toolbar's transform tools menu and the clip menu's Edit › (`lib/timeline-motion.ts`).

- **On a video or audio clip** (`lib/types.ts`, `SpeedProps`):
  - `speed`: constant speed (0.1–100×), or with a curve the curve's mean speed (its media over its length on the timeline).
  - `speedCurve: { preset?, points: [{x, y}] } | null`: CapCut's speed points, x the progress through the clip's media in the order it plays, y the speed (0.1–10×).
  - `reverse`: the clip plays its media backward. Its `trimStart` and `trimEnd` count in the order it plays: `trimStart` is cut off the media's end.
  - `freeze: { at }` makes a video clip a freeze frame: it holds its asset's frame at `at` seconds, without sound, as long as it's made.
  - `changePitch`: CapCut's Change audio pitch, the sound resampled with the speed instead of time-stretched (the engine's `change_pitch`; a curve's sound always follows its speed).
- **Helpers** (`lib/speed.ts`, pure, never writing to what they're given):
  - `CURVE_PRESETS` (name and points, in the tab's order: Custom, Montage, Hero, Bullet, Jump Cut, Flash In, Flash Out) and `presetCurve(name)`;
  - the remap: `curveAverage(points)`, `curveSpeedAt(points, q)`, `sourceProgressAt(points, q)`, `timelineProgressAt(points, p)`, `curvedLength(mediaFrames, points)`;
  - `sourceTimeAt(clip, localFrame, fps, mediaSeconds?)`: the asset time a clip shows (speed, curve, reverse, freeze), e.g. for the tab's "Duration: 4.0 s → 2.2 s" and a curve editor's playhead;
  - `speedPatch(clip, { speed } | { curve })`, `reversePatch(clip, reverse)`: the patches the store applies; `splitSpeedCurve(curve, p)` and `splitCurveFields(clip, cut)` (CapCut's cut of a curved clip); `retimeKeyframes`; `freezeFrame(...)`, the freeze as a function of the clips.
- **The store** (`lib/clip.ts`), each one undo step:
  - `updateClip(id, { speed })` is the Normal tab: the clip keeps its in-point and media, its end moves, its trims scale, keys stay on the media, and a curve is dropped;
  - `setSpeedCurve(id, curve | null)` is the Curve tab (a preset, or the editor's points as they're dragged);
  - `setReverse(id, reverse)` is the Reverse button;
  - `freezeFrame(id, frame)` is the Freeze button: cut at `frame`, a 3 s still of the frame there between the halves, the rest of the track and the linked clips 3 s later; it returns the still's id and selects it.
  - Linked clips (a video and its detached audio) take a speed, curve or reverse together, and a freeze cuts and moves them too. A curved clip cut in two plays the same media at the same times.
- **To the engine.** `convert_clip` turns `speedCurve` into a speed material the segment plays by, `reverse` into the segment's (its trims mirrored about the media's length), `freeze` into a still material drawn from the video, and `changePitch` into the segment's `change_pitch`. On a converted CapCut clip each applies when it differs from `base`: the app's curve replaces the draft's speed, and a freeze keeps the clip's effects. `to_app_project` shows a draft's curve (with its mean as `speed`), reverse and trims.
- **What the UI should know:**
  - CapCut's curve editor draws a bezier through the points (control points at the span's middle x, at each end's y); playback runs CapCut's ramp. `curveSpeedAt` gives the ramp, for a faithful curve.
  - CapCut ignores "Change pitch" on a curve: its sound always follows the speed. The tab should grey the toggle out in Curve.
  - A new point must be at least 3 frames from its neighbours in CapCut; points' speeds are clamped to 0.1–10×, and a curve to 10× only when the clip has a second or more of media.
  - CapCut offers Curve and Reverse on video clips, and Normal speed on audio; a freeze has none. The store takes them on audio too, so a video's detached audio follows it. A reversed clip's trim handles trim where it plays.
- **Checked:** `tests/speed.test.ts` (`node --test`, the engine's golden values), the v1 crate's tests, and the harness step `speed` (README): reversed frames and real-time reversed playback, a curve's length and frames, a freeze's frames and saved still, its silence and the sound after it in an export, each edit undone. Through the UI: `speedui` and `freezeui` (motion-suite.mjs).
- **The UI's limits:** the curve editor plots CapCut's ramp (`curveSpeedAt`) over the clip's media rather than CapCut's drawn bezier; a length rounds to whole frames, so a trip to 100× and back can change the media a clip spans (⌘Z gives it back exactly, and a length typed in the tab sets the exact speed for it).

## Colour and compositing

Done (2026-10-18): the data model, the library helpers and the engine. The Adjust tab (Basic, HSL, Curves, Color wheel, LUT), Video › Basic (Blend, Canvas, the transform presets, Mirror) and Remove BG › Chroma key are UI still to build on them ([colour.md](../parity/colour.md), [compositing.md](../parity/compositing.md)).

The panels are built (2026-10-18) on these fields and helpers, every control checked in the engine's frame and by undo with `insp-suite.mjs` (docs/inventory/current-app.md §13). The draft's own adjustments stay in Adjust ▸ Basic as before; the old sliders show only on clips that use them, with the move onto CapCut's.

- **On a video or photo** (`ClipLook` in `lib/types.ts`; every field optional, missing is neutral):
  - `color`: the Adjust tab's colour tools (`ClipColor`):
    - `adjust`: CapCut's Basic sliders by name (`AdjustSlider`: exposure, brightness, contrast, saturation, temperature, tint, highlights, shadows, whites, blacks, sharpen, clarity, vignette, fade) on CapCut's scale: −50…50; sharpen, clarity and fade 0…100; vignette −100…100 (below 0 it lightens the edges). 0 is off.
    - `hsl`: `{red: {hue, saturation, lightness}, …}` for CapCut's eight ranges (red, orange, yellow, green, cyan, blue, purple, magenta), −100…100.
    - `curves`: `{luma, red, green, blue}`, each a list of `[x, y]` points in 0–1, the ends included; the engine draws the smooth curve CapCut draws through them.
    - `wheels`: `{lift, gamma, gain, offset}`, each `{red, green, blue, luma}` (CapCut's values, −1…1; a puck's position sets red, green and blue), and `intensity` 0–100 (100 when missing).
    - `lut`: `{path, name, intensity}`: a `.cube` file or a Hald CLUT image, its strength 0–100, drawn first.
  - `auto` (inside `color`): Auto adjust, `{intensity, values, applied, range?}`: the Basic slider values the engine found from the clip's statistics (the panel's scale, at full intensity), the intensity 0–100, what it added to `adjust` (so turning it off removes only that), and the media seconds read.
  - `match` (inside `color`): Color match, `{intensity, source, reference, ref: {clipId, name?}, consistent?}`; `source` and `reference` are `{mean: [L, a, b], std: [L, a, b]}` in Oklab, `intensity` 0–100, `consistent` true when Make colors consistent set it. The v1 conversion (`engine/crates/v1/src/color.rs`) makes it the `color_match` effect (both sides' statistics as params, intensity 0–1), drawn before the LUT; with either side missing it adds nothing. The engine makes the 33-point table itself (openrip-analysis). Analysis runs through the addon (shot changes, statistics, auto adjust) and the `openrip-dev` CLI; see [scenes-and-colour-match.md](../parity/scenes-and-colour-match.md).
  - `blendMode` (videos, photos and texts): `"normal"` (CapCut's Default), `"darken"`, `"screen"`, `"overlay"`, `"multiply"`, `"lighten"` (CapCut's Brighten), `"color_burn"`, `"color_dodge"`, `"linear_burn"`, `"soft_light"`, `"hard_light"`. The Blend section's opacity is the transform's `opacity`, as before.
  - `chroma`: `{color: "#rrggbb", intensity, shadow, edgeSmooth, spill}`, the sliders 0–100. Intensity 0 keys nothing (a new key starts so, as in CapCut: pick the colour, then raise the intensity).
  - `canvas`: `{type: "color", color}`, `{type: "blur", blur}` (CapCut's levels 0.0625, 0.375, 0.75, 1) or `{type: "image", image}` (a path or file URL); null for none. Drawn only for a clip on the main track, as in CapCut.
  - `flip`: `{horizontal, vertical}`, mirrored on screen about the clip's middle.
  - On a text, `color` stays the text's colour; only `blendMode` applies there.
- **Keyframes** (`keyframes` on the clip, as for the other properties): `adjust:<slider>`, `hsl:<range>:hue` (`:saturation`, `:lightness`), `wheels:intensity`, `lut:intensity`, and `chroma:intensity` (`:shadow`, `:edgeSmooth`, `:spill`), each in its field's units. `editProperty`, `toggleKeyframe`, `valueAt` and `propertyValue` in `lib/keyframes.ts` read and write them, and `keyframeableProperties` lists them for videos and photos. Curves, the blend mode, the canvas and flips aren't keyframed (CapCut doesn't).
- **Helpers** (pure; each returns a patch for `updateClip`):
  - `lib/color.ts`: `ADJUST_SLIDERS` (CapCut's names, ranges and sections: Color, Lightness, Effects), `HSL_RANGES` (names and swatches), `HSL_PARTS`, `CURVE_CHANNELS`, `WHEELS`, `IDENTITY_CURVE`; `setAdjust`, `setHsl`, `setCurve`, `setWheel`, `setWheelsIntensity`, `setLut`; `colorOf`, `isNeutralColor`, `isIdentityCurve`; `migrateLegacyAdjustments` and `hasLegacyAdjustments` (below).
  - `lib/compositing.ts`: `BLEND_MODES` (CapCut's menu in its order, with its names), `canBlend`, `setBlendMode`; `CHROMA_SLIDERS`, `chromaKeyOf`, `setChroma`, `clearChroma`; `CANVAS_BLURS`, `canvasColor`, `canvasBlur`, `canvasImage`, `setCanvas`, `fillsCanvas` (whether the clip is on the main track, so its canvas shows) and `applyCanvasToAll` (CapCut's Apply to all: `[clipId, patch]` for every main-track clip).
  - `lib/transform-presets.ts`: `scalePreset` / `applyScalePreset` ("fit", "fill", "stretch", centred, by the turned size when a quarter turn puts the picture on its side), `rotate90` (about the centre), `toggleFlip`, `flipOf`, `worldOf(aspect)`, `centreOf`, `placeCentre`. The presets change the transform's scale, not its box, so keys and crops keep their meaning; when `scale` or `position` is keyed, set them with `editProperty` instead.
- **The old sliders** (`brightness`, `contrast`, `hue`, `saturation`, `blur`, `sharpness`, `noise`, `vignette`: `MediaAdjustments`, the engine's `v1:` effects) still draw exactly as before, so old projects look the same. The panels should edit `color` only, and show the old ones (when any is non-zero) as a legacy group with an action that calls `migrateLegacyAdjustments`: contrast, saturation, vignette and sharpness move onto CapCut's sliders at the closest value (measured; [colour.md](../parity/colour.md)), the others (brightness, hue, blur, noise) and keyframed ones stay. A slider already set in `color` isn't overwritten.
- **CapCut clips.** `to_app_project` shows a converted clip's blend mode, chroma key (when it keys anything), canvas fill (when it isn't black) and flips in these fields, and a field the app changes replaces the draft's (a chroma key keeps the draft key's keyframes). `color` starts null: the draft's own colour stays in `draftAdjustments` (edited there, as now), and `color` goes on top, a slider or HSL range set in both drawing the app's. Unedited, a converted clip comes back exactly (138.1 dB on every draft).
- **To the engine** (`engine/crates/v1/src/color.rs`, `compositing.rs`): each slider an Adjust effect (the value over CapCut's scale), each HSL range set an HSL material, curves a curves material with CapCut's handles, wheels a primary-wheels material, the LUT a filter on the clip, the blend mode a blend effect, the chroma key a chroma material, the canvas a canvas fill, flips the transform's: the materials CapCut's drafts have, so both draw through one path. Exposure and fade read CapCut's tables only for a draft that points at its colour bundle; on the app's own clips they're drawn from OpenRip's own fitted curves, with or without CapCut installed ([colour.md](../parity/colour.md)).
- **CapCut import:** `mix_mode` effects by bundle id or name, `chromas` and their four keyframed sliders, `canvases` (colour, blur, image), `clip.flip`, and filters on a clip (now drawn).
- **Checked:** `tests/compositing.test.ts` (`node --test tests/*.test.ts`: the lists against the engine's, each helper, the keyframe properties), the v1 crate's tests (fields to materials both ways, keys, a converted clip's edits), the engine's (`render/tests/compositing.rs`, `playback/tests/compositing.rs`), and the harness step `compositing` (15 checks in the engine's frames).
- **For the panels:** the chroma key's eyedropper should sample the clip's own pixels at the playhead; the Canvas section shows only for main-track clips (`fillsCanvas`); a clip's `canvas` stays when it leaves the main track and shows again when it comes back.

## Text templates

The Text tab's "Text template" section (`lib/text-templates.ts`, about 55 of our own designs in eight categories) holds
templates as data: layers of text clips (our text styles, glow, strokes, gradients, In/Out/Loop animations) and shapes
(the Shapes library's, and pen paths for drawn icons such as the heart and the bell), with keyframes for what moves.
Nothing is new to the engine's drawing: a template is the clips the app already has.

- **Model.** CapCut's template is one clip with fields to fill in. Ours is a group (the app's compound clip) of ordinary
  clips, each layer on a track of its own, so every layer keeps its inspector, animations and keyframes, and Ungroup frees
  them. The group carries `template: { id, name }`; selecting it (or double-clicking it on the timeline) opens a
  "Text template" tab listing the template's texts as fields (`templateField` on each text names it), and each field's brush
  selects that text for the whole Text tab.
- **Insertion** (`lib/text-template-actions.ts`): a track per layer, the layers' clips, a track for the group and `groupClips`,
  all one undo step. The block is laid out in 16:9 world units and scaled to the project's canvas; `place` puts it in the
  middle or against an edge.
- **Previews** are drawn by the engine: `engineProjectPreviews` (core `ProjectPreviews`, node `projectPreviews`) renders frames
  of a small project given as JSON, optionally cropped, through the same preview renderer as the player and an export. A
  tile shows one frame, plays 12 frames a second while hovered; a click plays the template over the player at its place.

## Text styles and captions

Done (2026-10-18): the data model, the library files and the engine for the Text tab's Basic (spacing, gradient fill, outlines, glow) and Effects, the Add-text presets, and Captions ▸ Import and export. The panels are UI still to build on them ([text-styles.md](../parity/text-styles.md) has CapCut's side and the checks).

- **On a text clip** (`lib/types.ts`, `TextClipProps`):
  - `letterSpacing`, `lineSpacing`: CapCut's Character and Line fields as it shows them, steps of 1/20 of the font size (−10…100, 0 by default). Not keyframeable: CapCut doesn't key them.
  - `fillGradient: { colors, stops?, angle, span? } | null` (`TextGradient`): colours ("#rrggbb" or "#rrggbbaa") along a line through the middle of each character (`span` "character", the default), each line ("line") or the whole text ("text"), `angle` degrees counter-clockwise from +x (0 left to right, 90 bottom to top). It replaces `color`, whose opacity still applies.
  - `moreStrokes: [{ color, width, opacity? }]` (`TextOutline`): outlines outside the stroke, width in px like `strokeWidth`, each under the one before. CapCut's panel has one stroke; its drafts' rich text keeps a list, and the Effects styles use several.
  - The glow: `glowEnabled`, `glowColor` ("" or null for the text's own colours), `glowIntensity` and `glowRange` (0–100; CapCut starts at 30 and 20), `glowOffsetX` and `glowOffsetY` (−100…100, the light moved right and down; CapCut's X/Y offset). `glowColor`, `glowIntensity` and `glowRange` are keyframeable (`lib/keyframes.ts`; a glow in the text's colours keys from the text's colour).
  - `textEffect: TextEffectStyle | null`: the Effects tab's style. `{ id, name?, fill?, strokes?: [{ width, paint }], shadows?: [{ paint, distance, angle, blur }], glow?: { color?, intensity, range } }`, sizes as fractions of the font size; a paint is `{ color, opacity? }`, `{ gradient, opacity? }` or `{ textColor: true, opacity? }` (the clip's own colour, so a style follows Basic's colour). It's drawn in place of the clip's colour and stroke; the clip's own glow wins over the style's. A converted CapCut clip's library style shows as `{ id: "", name }`: drawn from CapCut's bundle and kept until replaced or set to null.
- **Library files** (pure, `import type` only or other pure libs; set the results with `updateClip`, or add clips with `addTimeline`/`addClip`, which makes one undo step):
  - `lib/text-styles.ts`: `TEXT_STYLES` (id, name, category Outline/Glow/Shadow/Gradient, the style), `textStyle(id)`, `textEffectOf(id | null)` (the field, a fresh copy; null for None), `isCapCutStyle(style)`, and `textStyleCss(style, textColor, fontSizePx)` for a tile's CSS look.
  - `lib/text-presets.ts`: `TEXT_PRESETS` ({ id, name, category, props, animationIn? }), `textPreset(id)`, `BASE_TEXT` (the Text tool's starting look) and `presetTextClip(preset, { clipId, timelineId, startFrame, fps, canvas, seconds?, totalFrames? })`, the clip centred on a canvas in world units with its In animation made. The first eight are the shell's app styles (plain, title, outline, shadow, label, serif, caps, yellow). `addPresetText(preset)` (the Text tab's Add text) adds the clip at the playhead on a new track, selects it and opens its Text tab; it loads the stores when called, so the rest of the file is pure.
  - `lib/captions.ts`: `parseCaptions(text)` reads an .srt or .vtt (→ `{ cues: [{ start, end, text }], skipped }`, seconds, sorted); `captionClips(cues, { fps, canvas, style?, makeId, offsetFrames?, bottom? })` makes a text track and its clips (on frames: cues on the same frame joined, an overlap ended at the next cue; low on the canvas in `CAPTION_STYLE` or the style given, e.g. a preset's props); `clipsToCues(clips, fps, { timelineIds? })` and `writeSrt(cues)` export; `parseTime`, `formatSrtTime`, `cueFrames`, `shownText` underneath.
- **Files:** the preload's `pickMediaPaths({ filters: [{ name: "Subtitles", extensions: ["srt", "vtt"] }] })` and `readFileBuffer` to import; `pickSavePath({ defaultPath, filters })` (new: the native save dialog, `dialog:pick-save-path` in `NativeFileDialog`) and `writeFileBuffer` to export.
- **To the engine** (`engine/crates/v1/src/text.rs`): spacing in em (× 1/20; CapCut's text keeps its 0.02 at Line 0); the gradient, outlines and glow as the text material's; the style as a text style material attached to the segment (`openrip:<id>`). On a converted clip each field applies on top of the draft's text when it differs from `base` (all are in `TEXT_STYLE_KEYS`), a draft's glow keeping its CapCut style; `to_app_project` shows a draft's spacing (0.05 as Character 1, 0.12 as Line 2), gradient, strokes past the first, glow and library style in these fields. A project converted before the fields existed keeps its text exactly.
- **CapCut import:** a style's `bloom` (the glow), a gradient fill, every stroke, spacing, and the glow's keyframes; inner shadows, a second shadow, texture fills and radial gradients go in the report's `unmapped_library`.
- **What the UI should know:**
  - CapCut's Glow section has two style tiles; OpenRip draws one glow (CapCut's first style's look) for both, so a second tile has nothing to pick yet.
  - CapCut's colour picker on desktop has no gradient; the gradient field is for imported drafts, the Effects styles and a gradient picker if wanted.
  - Bubbles aren't done: CapCut's are downloaded image bundles ([text-styles.md](../parity/text-styles.md)).
- **The panels** (2026-10-18):
  - **Text ▸ Basic** (components/properties/text/TextBasicProperties.tsx) in CapCut's order: the text box, Font (FontPicker.tsx), Font size, B U I, Case, Color (ColorWell.tsx: CapCut's picker, no alpha), Character and Line spacing, Alignment, the clip's Transform and Blend (the shared Position, Layout and Appearance panels), then Stroke, Background, Glow, Shadow (CapCut's Distance and Angle, stored as `shadowOffsetX/Y`) and a gradient fill (`fillGradient`: two colours, angle, across each character, line or the text). Keyframeable fields are edited with `editProperty` and shown at the playhead (`valueAt`). The keyframe diamonds come with PropertyRow's. One stroke, as CapCut's panel has; `moreStrokes` stays for drafts and styles.
  - **Text ▸ Effects** (TextEffectsProperties.tsx): `TEXT_STYLES` as tiles previewed with `textStyleCss`, a search and the categories, None first; a converted clip's library style shows by name.
  - **Left panel ▸ Text** (menus/TextMenu.tsx): the default text and `TEXT_PRESETS` by category, tiles drawn by menus/TextLook.tsx; click, or drag onto the timeline or the player (native drag and drop, so it stays out of the timeline's media drops), runs `addPresetText`.
  - **Left panel ▸ Captions** (menus/CaptionsMenu.tsx, lib/caption-actions.ts): `importCaptionFile` (the preload's `pickMediaPaths`, `readFileBuffer`, `parseCaptions`, `captionClips` in the chosen `CAPTION_STYLES` look, then `addTimeline` and `addClip`: one undo step); `applyCaptionStyle` on a track; `exportCaptions` (`clipsToCues` over the visible texts, `writeSrt`, `pickSavePath`, `writeFileBuffer`).
- **Fonts** (2026-10-18). The engine draws the fonts the font menu shows:
  - **The app's bundled fonts.** lib/fonts.ts reads the page's `@font-face` rules (family, weight, slant, `unicode-range`, the WOFF2 file's URL) and sends them once per page, before the first sync or export (`engineRegisterFonts` → `engine:register-fonts`). Main finds each file (a file URL, the dev server's `/@fs/` path, or a copy of an `app://` or dev-server URL in `<userData>/engine-fonts`) and calls the addon's `registerFonts`, which is `openrip-core`'s `register_fonts`: faces read through the asset seam when first drawn.
  - **The engine** (`openrip_render::fonts`, `text::Font`): WOFF2 decoded in pure Rust (`wuff`); a web font's files for one weight and slant drawn together, each character from the first file with a glyph for it (`Font::with_fallbacks`; the Latin file first), as a browser picks by `unicode-range`; CSS's matching of weight and slant, bold or italic synthesised only when the family has no such face. The app's own text resolves registered faces, then installed ones; CapCut's text keeps its own lookup plus a bundled font the app picked for it, so drafts draw as before (`app-roundtrip`: every draft at 138.1 dB).
  - **Installed fonts** are found by reading only the name, OS/2 and head tables of the files in the platform's font folders (`font_folders`: macOS's, Windows', Linux's and Android's; none on iOS or the web, whose clients register theirs), once: 305 families and 687 faces in 14 ms on this Mac. `fontFamilies` lists them for the menu (`openrip-dev fonts`).
  - **Checked:** the harness step `fontcheck` draws a word in each bundled family (and Poppins Bold, Georgia, Futura and Helvetica Neue) and compares the engine's glyphs with the browser's canvas in the same font: IoU 0.88–0.97, against 0.32–0.76 for Arial, with the same width-to-height ratios.
  - **Underline** is drawn (it wasn't): under each line at the font's own underline position and thickness, in the fill and inside the outlines.
- **Checked:** `tests/captions.test.ts` and `tests/text-styles.test.ts` (`node --test`), the v1 and importer crates' tests, the render tests, and the harness steps `textstyles` (README; 13/13) and `captextstyle` (a converted caption, 5/5); for the panels, `texttab` (every Basic and Effects control changes the engine's frame and the saved clip, the main ones undone and redone; 42/42) with `texttabcheck` after `reopen` (the 33 fields and the same frame), `textpresets` (9/9), `captionsio` (7/7) and `fontcheck` (16/16).

## Audio tools

Done (2026-10-18): the data model, the library helpers, the engine and the voiceover's back end for CapCut's Audio tab (Basic, Voice changer), beat markers and the timeline's voiceover button ([voice-effects.md](../parity/voice-effects.md), [loudness.md](../parity/loudness.md), [beats.md](../parity/beats.md)); then the UI on them: the inspector's Audio tab, the Voiceover panel, the beat markers and tools on the timeline, and the left panel's Audio tab (docs/inventory/current-app.md §13; the store calls in `lib/audio-tools.ts`; checked by the harness steps `audioui`, `audiouicheck`, `audiosep`, `voiceoverui`, `voiceoverdenied`, `beatsui` and `audiolib`).

- **On a video or audio clip** (`ClipAudio` in `lib/types.ts`; every field optional, missing is off):
  - `audioEffects: [{type, params?, name?}]`: voice effects, played one after another after the clip's speed and before its volume. `type` is one of the engine's kinds (`AudioEffectKind`: pitch, robot, echo, reverb, chorus, tremolo, distortion, bitcrush, lowpass, highpass, eq, telephone, megaphone, gain), `params` its parameters by key (missing ones take the kind's defaults; every kind has `strength` 0–100), `name` the preset it came from. A converted CapCut clip lists its own voice filter as `{type: "draft", id, name}`: CapCut's bundle, which plays as CapCut's; it has no parameters, and leaving it out of the list removes it.
  - `loudness: {enabled, target, measured, peak, range}`: Normalize loudness. `target` is −23 LUFS (CapCut's); `measured` (LUFS) and `peak` (dBFS) are the clip's, over `range` ([start, duration] s of media). Without `measured` nothing changes.
  - `channel: "none" | "left" | "right" | "mono"`: Fill channel. "left" is CapCut's "Fill right with left", "right" its "Fill left with right"; "mono" is OpenRip's own. CapCut has no balance or pan.
  - `beats: {manual?, auto?, everyBeat?, detected?}`: beat markers in seconds of the clip's media (so they stay on the music through trims and moves): `manual` marked by hand, `auto` the automatic ones shown, `everyBeat` all of them (CapCut's Beat 2) or bar starts only (Beat 1), `detected` a CapCut draft's own automatic beats.
  - Volume keyframes are the `volume` property of `lib/keyframes.ts`, as before: the mixer now follows them sample by sample.
- **Helpers** (pure; each returns a patch for `updateClip`):
  - `lib/audio-effects.ts`: `AUDIO_EFFECT_KINDS` (each kind's name and parameters: key, label, range, step, unit, the engine's default), `paramsOf(kind)` (Strength last), `AUDIO_EFFECT_GROUPS` and `AUDIO_EFFECT_PRESETS` (OpenRip's presets by group: Deep, Low, High, Chipmunk, Helium, Monster, Robot, Alien, Tremble, Vibrato, Chorus, Echo, Mic Echo, Small Room, Hall, Cathedral, Telephone, Megaphone, Lo-Fi, Distorted, Muffled, Thin, Bass Boost, Voice Crisper, Fuller Voice), `presetById`; `applyPreset` (CapCut's Voice changer picks one: it replaces the list), `addAudioEffect` (stacking, OpenRip's), `removeAudioEffect`, `clearAudioEffects` (CapCut's None), `setEffectParam` (clamped to the range), `paramValue`, `applyEffectsToAll` (Apply to all), `hasSound`.
  - `lib/audio.ts`: `normalizeLoudness(clip, path, fps, measure, mediaSeconds?)` (async: measures the range the clip plays with `measure`, the preload's `engineLoudness`, and returns the patch), `loudnessOff`, `loudnessStale` (a trim moved the range: measure again), `loudnessGain` (the dB applied, for the panel), `playedRange`, `LOUDNESS_TARGET`; `CHANNEL_FILLS` (the menu, CapCut's names) and `setChannelFill`; `placeVoiceover` and `voiceoverClip` (below).
  - `lib/beats.ts`: `addBeat(clip, mediaTime)`, `addBeatAtPlayhead(clip, frame, fps, mediaSeconds?)` (Mark beats), `removeBeat`, `setAutoBeats(clip, on, everyBeat?)` (Auto beat), `clearBeats` (Clear beats); `shownBeats(clip, grid?)` (media seconds), `beatFrames(clip, fps, grid?, mediaSeconds?)` (timeline frames, through trims, speed, curves and reverse; trimmed-off markers left out), `mediaTimeAt` / `frameOfMediaTime`; `beatsOfFile(path, find)` (the engine's beats for a file, asked once per session; `find` is the preload's `engineBeats`) and `beatSnapPoints(clips, fps, grid, mediaSeconds, exclude)`.
  - Snapping: `snapPoints(clips, { playhead, markers, exclude, beats })` in `lib/timeline-edit.ts` takes the beats (from `beatSnapPoints`, the moved clips excluded); without `beats` it's as before.
- **The engine over IPC** (preload):
  - `engineBeats(path)`: `{bpm, beats: [{time, downbeat}]}` or null; the engine keeps each file's beats on disk with the waveforms.
  - `engineLoudness(path, startSec, durationSec | null)`: `{integrated, peak}` (LUFS, null for silence; dBFS) or null, as CapCut measures ([loudness.md](../parity/loudness.md)).
- **Voiceover** (the main process's `VoiceoverModule`; preload):
  - `voiceoverStatus()`: `{available, recording, permission, projectMuted}` (the microphone permission: "granted", "denied", "restricted", "not-determined", "unknown"; `projectMuted` while a take with Mute project lasts).
  - `voiceoverStart(folder?, {muteProject}?)`: asks macOS for the microphone the first time (refused: `{ok: false, denied: true}`), then records the default microphone into `<userData>/media/<folder>/voiceover/Voiceover N.wav` (16-bit WAV at the device's rate and channels). `folder` is the project's media folder id; none for the shared one. `muteProject` silences the engine's playback until the take stops or is thrown away (the panel's Mute project).
  - `voiceoverList(folder?)`: the takes in that voiceover folder, newest first (`{path, url, name, modifiedMs}`), for the Audio tab's Voiceovers.
  - `onVoiceoverLevel(cb)`: `{peak, rms, elapsedMs}` about 20 times a second while recording (peak and RMS 0–1 since the last report); returns an unsubscribe.
  - `voiceoverStop()`: `{ok, path, url, durationSec, rate, channels}`; the file is linked into the project's media library like an import. `voiceoverCancel()` stops and deletes the take.
  - Then `placeVoiceover(useClipStore.getState(), {path, durationSec}, url, playheadFrame, fps)` adds the asset and an audio clip on a new audio track at the playhead, as CapCut does, and returns the clip.
  - Tests set `OPENRIP_FAKE_MIC=1`: the engine records a stand-in microphone that hears a 440 Hz tone at a quarter of full scale, and nothing is asked or recorded for real; `OPENRIP_FAKE_MIC=denied` answers as a refused microphone. Packaged macOS builds carry the microphone entitlement and usage text.
  - CapCut's panel also has an input device menu, input volume and Echo reduction: the engine records the default device at its level and doesn't reduce echo.
- **CapCut clips.** `to_app_project` shows a converted clip's voice filter (as a "draft" entry), loudness material, channel fill and beats in these fields; a field the app changes replaces the draft's. A video whose sound CapCut extracted to an audio clip stays silent (its extracted clip plays it), through the app's project too. Unedited, a converted clip comes back exactly (138.1 dB, and its mix the same to float rounding).
- **To the engine** (`engine/crates/v1/src/audio.rs`): each effect an audio effect material (`builtin` its kind), loudness a `Loudness` material, the fill a `ChannelMap`, beats a `Beats` material: what CapCut's drafts give, so both play through one path.
- **CapCut import:** `audio_effects` (as before), `loudnesses` (as before), `sound_channel_mappings` (1 left on both sides, 2 right, while `is_config_open`), `beats` (`user_beats`, `enable_ai_beats`, `gear`, and the beats file CapCut downloaded with the song), and `video_original_sound` audio silencing its video. Not mapped: Enhance voice (`vocal_beautifys`) and Isolate voice (`vocal_separations`), AI results CapCut renders and didn't leave here, and `user_delete_ai_beats` (always null locally).
- **Checked:** `tests/audio.test.ts` (`node --test tests/*.test.ts`: every preset against the engine's kinds and ranges, the patches, loudness's range and staleness, the voiceover's placing, beats through trims, speed, curves and reverse, snapping), the engine's tests (each effect on tones and impulses, the meter, channel fill and keyed volume through the mixer, beats on clicks, the recorder on a fake input, the v1 and CapCut mappings), `openrip-dev loudness-scan` and `beat-scan` against CapCut's numbers, and the harness step `audio` (normalising, the fill, Telephone and strength 0 in exports; a voiceover from the stand-in microphone recorded, placed and heard in an export).
- **For the panels:**
  - CapCut's Voice changer shows one selected filter with a Strength slider; `applyPreset` then `setEffectParam(clip, 0, "strength", v)`. The Hall/room presets' own `mix` is the reverb's level; Strength mixes the clip back in.
  - Normalize loudness: call `normalizeLoudness` when it's switched on, and again when `loudnessStale` says the clip was trimmed; show `loudnessGain`.
  - Beat markers on a clip's bar: `beatFrames(clip, fps, grid, mediaSeconds)` with `grid` from `beatsOfFile(assetPath, engineBeats)` once Auto beat is on.
  - The voiceover button: `voiceoverStart` on press, the meter from `onVoiceoverLevel`, `voiceoverStop` then `placeVoiceover` on the second press (CapCut starts a 3-2-1 count first; that's the panel's).

## Speed on large projects

Done (2026-10-17), measured in the app on the largest local drafts (222, 211 and 120 clips; one has 101 photos and 113 captions). The draft with 222 clips:

| | before | after |
|---|---|---|
| open | ~10 s | ~1 s |
| seek (click to new frame) | 552 ms median, 1.9 s p95 | 170 ms median, 290 ms p95 |
| scrub | 6 frames/s, renderer blocked 9.9 s | 17 frames/s, never blocked |
| playback | 22.7 fps | 24.1 fps, no gap over 100 ms, renderer never blocked |
| an edit reaching the picture | not measured | 40–100 ms |

What it took:

- **Opening.** The engine measured every caption by drawing it (9 s); it now only lays it out (23 ms). Each clip's WebGL mask context was made up front (5 s); it's made on first use. Photo thumbnails decode at their tile size (`createImageBitmap` with a resize) and tile from one GPU upload. Every photo thumbnail also moved its clip to the end of the clip list, which re-rendered the whole project and resynced the engine once per photo, and with a hundred photos tripped React's update-depth limit; it no longer reorders anything.
- **Scrubbing.** While the playhead is dragged the engine shows the nearest decodable frame: the exact one when it's at most 3 frames ahead of where the decoder is, otherwise a decoded frame within half a second, otherwise the keyframe (`PreviewEngine::set_scrubbing`). Main renders the next frame while the last one is delivered. Since then the pictures a drag needs are got ready ahead of it (below).
- **Playback.** Clip previews don't draw while the engine does, and they re-render only when the playhead enters or leaves them (`useClipFocusFrame`). The clip previews and timeline clips are memoised, the preview hands each clip the same filter list until the clips or the filters over it change, and components subscribe to the store fields they use rather than the whole store.
- **Missing media.** A video whose frames never decode (offloaded or deleted media) made its timeline strip re-render itself in a loop, which took most of the renderer during playback and held scrubbing to 4 frames/s. It now redraws once.

The engine-only benchmarks are `openrip-dev seek-bench <draft> [--scrub]` and `pipeline-bench`; with `OPENRIP_TRACE` set, main logs each sync and frame, and the engine each frame over 30 ms (gather, layers, composite).

### Scrubbing ahead

Done (2026-10-17). Where a scrub frame's time went on the 222-clip draft (one 4K H.264 video with a keyframe every second, and two tracks of full-frame 2160×3840 subtitle PNGs changing every second or so), from `OPENRIP_TRACE`:

- **Engine, 75–150 ms whenever a subtitle changed.** The video's keyframe: ~20 ms of VideoToolbox, almost all latency. Each new still: a PNG decode on the render thread (11–30 ms), then 25–40 ms in the compositor to premultiply and upload all 33 MB of it and shrink it to a 506×900 preview. With nothing new to decode, a frame took ~6 ms.
- **Delivery, 5–17 ms.** Main hands the window the frame's IOSurface (no pixels are copied) and the preload draws it into the page's canvas. It runs beside the next frame's rendering, so it only caps the rate, at ~80 frames/s; it wasn't the limit, and isn't changed.
- **Renderer.** No long tasks while dragging.

What changed (`engine/crates/playback/src/scrub.rs`):

- **Stand-ins got ready ahead of the drag.** Each scrub frame tells the engine where the drag is. From its speed over the last 300 ms, it plans the next 300 ms of the drag (1 to 12 s of timeline): each video keyframe and each still the drag will reach, nearest first. Three worker threads get them ready while the render thread draws the current frame; the render thread waits for one a worker already has in hand and does the rest itself. Keyframes decode in parallel (4K keyframes: 21 ms each on one VideoToolbox session, 7 ms each on four).
- **Stand-ins at the preview's size.** VideoToolbox scales a keyframe as it decodes (`DecoderOptions::shrink_to`, by a whole factor so the long side stays at least the preview's): a 2160×3840 keyframe comes out 540×960, 0.8 MB instead of 12 MB. Stills are box-filtered down the same way (weighted by alpha, clear blocks of four pixels skipped: 6 ms for a 4K subtitle). Uploading a 2 MB stand-in costs next to nothing. Stand-ins have their own memory (96 MB of keyframes, 128 MB of stills) and are only shown while dragging; the frame on release is exact, as before.
- **Keyframe seeks.** Container index times can be decode times, before the keyframe is shown (B-frames), and seeking to one lands in the GOP before it. Workers seek to the middle of the GOP and file what they decode under its own keyframe.
- **Only for VideoToolbox's own decoding.** Videos FFmpeg decodes (ProRes, software) give full-size frames, and ProRes, intra-only, would plan every frame; they scrub as before.
- **Exact frames' stills decode beside their video.** A frame with a video and stills to load, or several stills, decodes the stills on the same workers instead of one after another on the render thread.
- **A memory budget for stills.** The engine kept every still it had decoded: playing or dragging through the 222-clip draft piles up to 3.4 GB of subtitles (104 of 33 MB) in each engine. Stills now share 512 MB, least recently drawn first out. A PNG that's already RGBA is no longer copied after decoding.

Measured on the 222-clip draft, main's build and this one alternating. The machine was loaded throughout (load average 20–200 from other work). When it was saturated both builds fell to 2–14 frames/s scrubbing and both dropped frames in playback, so the app's numbers are from the runs where it wasn't (13 runs, load 20–90):

| | before | after |
|---|---|---|
| scrub in the app (perf step) | 15–18 frames/s, gaps p50 37–86 ms | 41–77 frames/s, gaps p50 12–15 ms |
| engine during the scrub | 75–150 ms per frame with a new subtitle | 2–10 ms, a few at 30–70 ms |
| `seek-bench --scrub`, 120-step drag | p50 25 ms, p90 64–76 ms | p50 3–6 ms, p90 14–38 ms |
| `seek-bench --scrub`, the app's drag in real time | 17–22 frames/s, p50 61–63 ms | 218–383 frames/s, p50 2 ms |
| `seek-bench --scrub`, peak memory | 3.3 GB | 1.2 GB |
| seek (click to new frame) | 172–212 ms median | 133–183 ms median |
| playback | 22.6–24.2 fps, 0–2 gaps over 100 ms | 23.0–24.2 fps, 0–4 gaps over 100 ms |
| an edit reaching the picture | 55–63 ms | 20–61 ms |

In the calmest runs both builds play at 24.0–24.2 fps with no gap over 100 ms; the gaps above come with load, in both. `pipeline-bench` (playback in the engine alone), run 14 times alternating, shows no difference between them.

`seek-bench --scrub` now also drags in real time: the playhead crosses 80% of the project in 2 s, and each frame renders into a preview surface wherever the playhead is when the last one is done, as in the app.

### Exact frames with new stills

Done (2026-10-17). Scrubbing showed stand-ins; every exact frame (a seek, the frame on release, playback, export, an edit) still drew its stills whole. On the 222-clip draft each subtitle is a 2160×3840 PNG, and two change about once a second. Where a new still's time went in the compositor, on the render thread (`openrip-dev still-bench` and a trace of the upload):

- **Premultiplying, ~15 ms.** The compositor copied the picture (33 MB) and premultiplied it pixel by pixel on the CPU.
- **Writing it to the GPU, ~5 ms.** `Queue::write_texture` copies the picture into a staging buffer, row by row.
- **The GPU, 2–4 ms.** Copying it into the texture, shrinking it to the frame (area average and sharpen, CapCut's model) and placing it. A frame with nothing new takes ~1.5 ms.
- Decoding the PNG was already off the render thread: on the scrub workers for exact frames, on the prefetch thread for playback and export.

What changed (`engine/crates/render/src/upload.rs`, and where the engine decodes stills):

- **Premultiplied on the GPU.** Pixels are written as they are and a pass premultiplies them, rounding exactly as the CPU did, (c·a + 127) / 255 in integers, so every pass after it sees the same 8-bit values. Nothing is copied or premultiplied on the CPU.
- **Written by the threads that decode them.** The prefetch thread (playback, export) and the scrub workers (an exact frame's stills) write each still they decode to the GPU and premultiply it there, through an `Uploader` the compositor hands out; the frame that first draws it finds it ready. Stills decoded earlier that are no longer on the GPU (seeking back) are written by the workers beside the frame's video. The workers copy into a mapped buffer of their own, one still at a time, and wait for their own upload: `write_texture` holds the queue's lock for its whole copy, which held up the render thread's submissions. Frames wait for their own submission only. Playback's prefetch writes stills only while frames follow each other (playing, exporting): after a seek or while dragging they would wait on the GPU for nothing.
- **Kept on the GPU while drawn at new sizes.** A premultiplied still stays until the end of the frame after the one that last resampled it, and one written ahead until it's drawn, within 192 MB (drawn ones out first): a still whose scale is dragged is resampled frame after frame without being written again.
- **Not done, on evidence.** Uploading a smaller picture shrunk on the CPU can't give the same pixels: the area average reads fractional footprints of the full picture (2160 → 506 pixels is a factor of 4.27), and the GPU shrinks a 4K still in ~1.5 ms anyway. Mipmaps would change pixels too. Exports already shrink on the GPU from the full picture at their own size.
- With `OPENRIP_TRACE` set, each slow frame says how many megapixels it wrote to the GPU itself.

Pixels are unchanged: five frames of every local draft (325 frames, 65 drafts) are byte-identical to main's, `cover-parity` prints the same numbers, the 32 drafts that round-trip give 138.1 dB, and exports of the 222-clip draft (at its size and at 720×1280) and of the 211-clip draft decode to the same frames (MD5 of each) as main's. New tests check the premultiply against the CPU's rounding for every colour at every alpha, that a still written ahead, or drawn the frame before at another size, draws exactly as one written by its frame, and the GPU budget and expiry.

Measured on the 222-clip draft, main's build and this one alternating (load average 8–20; ranges over the runs):

| | before | after |
|---|---|---|
| a new 4K still in the compositor, preview (540×960) | 18–19 ms | 10 ms written by the frame, 2.4–2.6 ms written ahead |
| ... into an export frame (1080×1920) | 17–18 ms | 9–10 ms, 3.8–4.1 ms written ahead |
| ... its scale being dragged | 17–18 ms a frame | 2.5–3.9 ms |
| `seek-bench`, 24 seeks | p50 71–72 ms (warm 65–66), p90 77–89 ms | p50 44–45 ms (warm 42–43), p90 49–60 ms |
| real-time playthrough (30 s), frames where a clip starts | p50 44–48 ms, p95 66–114 ms; 19–24 frames over budget | p50 6–9 ms, p95 13–21 ms; 1–3 frames over budget |
| export, 63 s at 1080×1920 | 9.6–9.8 s | 8.2–8.5 s |
| seek in the app (`perf` step: click to frame) | p50 119–131 ms, p95 196–248 ms | p50 79–123 ms, p95 171–244 ms |
| playback in the app | 24.1–24.2 fps, no gap over 100 ms | 24.1–24.2 fps, no gap over 100 ms |
| scrub in the app | 81–100 frames/s | 81–97 frames/s |
| an edit reaching the picture (a clip moved: its stills are on the GPU already) | 50–58 ms | 26–55 ms |
| peak memory (footprint): playthrough / `seek-bench` | 885 / 1197 MB | 924 / 1288 MB |

A frame with a new still now spends ~6 ms compositing (read back included); the rest of a seek is the video's decode (25–55 ms from its keyframe). `pipeline-bench` shows no difference (0 frames dropped in both, longest gap 54–87 ms), nor does the real-time drag of `seek-bench --scrub` (456–518 against 457–492 frames/s). Earlier runs against the previous build, with the machine at load 25–100, gave the same picture: a new still 22–35 ms before, 10–17 ms written by the frame, 3–5 ms written ahead.

`openrip-dev still-bench <draft>` is new: a project's stills drawn full-frame as new stills, written ahead, again from the GPU cache and with their scale dragged, into a preview surface and an NV12 export buffer; then frames drawn while another thread writes stills.

## Undo and redo

Done (2026-10-17): ⌘Z, ⇧⌘Z and ⌘Y, and Undo and Redo at the head of the timeline toolbar, as in CapCut (`renderer/src/lib/history.ts`).

- **What's kept.** States of the project's document: its clips, tracks, assets and canvas (and the duration, which follows the clips). Not the playhead, selection, zoom or views. Every edit goes through the stores, so recording what they hold covers every panel, tool and shortcut, with CapCut clips' `engine` payload and masks inside the clips. Clips and tracks come back together, so no clip is left on a track that's gone. A state is put back through the stores too: the autosave writes it and the engine syncs it.
- **Steps.** A step is one user action: everything from one press of a mouse button or a key to the next. A drag (a slider, a clip, a handle, a mask) is one step however many changes it makes. So are the changes the app makes by itself after an edit: a track left empty is removed, a new clip's box is fitted, the engine lays a CapCut text out again. Typing in one field is one action while the keys come less than a second apart. Media info arriving for an import is folded into the current state, and a click that changes nothing isn't a step.
- **Memory.** The stores replace what an edit changes and keep the rest, so states share everything else. The clip store copies every clip on each edit (to sort them), so a state going into the history takes its neighbour's clip wherever the two are equal field for field: a step keeps the clips its edit changed and an array of references. 100 steps are kept. On a project of 222 clips with CapCut payloads (0.9 MB of clips as JSON), 100 one-clip edits keep 0.35 MB (5.9 MB without the sharing), and a step costs well under a millisecond: the check that an action changed anything (0.01–0.2 ms) and the sharing (0.2–0.8 ms), once per step, not per change of a drag.
- **Selection.** Undo selects what was selected before the step: a deleted clip comes back selected, and a split gives back its clip. Redo selects what was selected when the step was undone.
- **Per project.** The history starts empty whenever a project opens (a switch, a reopen, a CapCut draft), so ⌘Z never reaches into another project.
- **Text fields keep ⌘Z** for their own typing. Nothing is undone during a drag.
- The preview moves every clip to the middle when the canvas changes size; it leaves them when an undo or redo puts a canvas back with its clips where they were. A text's preview whose clip had just gone (a delete, an undone add) broke React's rule of hooks; it now draws nothing until it goes.
- Checked in the app with the harness steps `undo`, `capundo`, `undoreopen` and `animundo`: for each kind of edit (a text dragged on the canvas, a position typed, the Brightness slider dragged, volume, a mask drawn, case, colour and font, an In animation, a move, a trim, a split, a transition, a delete, a new text, a filter dropped on the timeline and its intensity, a group, a track hidden, the canvas), undo gives back the engine's frame and the saved project exactly and redo the edit, each edit one step. Undoing everything goes back to the project as opened, and redoing everything to the last edit. On drafts: a caption's case and font (with the box following the engine's layout), a video's position and Brightness, a caption moved and deleted, and on the calibration draft one of CapCut's own adjustments set, removed and put back; everything undone gives back the draft as opened.

## Timeline editing

Done (2026-10-17): the timeline edits as CapCut's (docs/inventory/capcut.md §2), in the app; the engine draws what the edits leave and needed no change.

- **Rules, not UI.** The rules are plain functions of the clips and tracks (`renderer/src/lib/timeline-edit.ts`): which track is the main one (the lowest video track), laying it out end to end, where a dropped clip goes in, links, locks and snapping. The clip store applies them to every edit it makes (`withTimelineRules`), so a panel, a shortcut and a drag all get them; a state put back by undo or loaded from a file is left as it was.
- **Magnetic main track** (on by default; P and the toolbar's toggle; saved in the project): a clip dropped, dragged or pasted onto it goes in before or after the clip under the pointer, its clips moving aside during the drag; a deleted, trimmed or removed clip closes the gap (ripple delete). Overlay tracks keep their gaps. A project opens with the magnet only over a main track already gapless, so opening it never moves a clip; a CapCut draft's comes from its `config.maintrack_adsorb`.
- **Delete left / right** (Q / W), split (⌘B; with nothing selected the main track's clip), and CapCut's other keys: Space, arrows, ↑/↓ edits, Home/End, [ / ], ⌘A, ⇧⌘S, ⌘= / ⌘−, ⇧Z (`lib/timeline-shortcuts.ts`; which key is which action is `lib/keymap.ts`'s, changed in the Shortcuts window). M is now Add marker, as in CapCut.
- **Snapping** to the playhead, markers and every clip edge on every track, for drags and trims, with the guide line; N toggles it, held ⌘ skips it.
- **Markers** (M), tags under the ruler with a name, time and colour in CapCut's box, ⌥← / ⌥→, dragged, deleted; saved in the project and imported from CapCut drafts' timeline markers.
- **Tracks**: add, delete, reorder by dragging the header, lock (a locked track's clips can't be selected or edited); a track an edit empties goes in that edit, one added empty stays. The main track stays the lowest video track.
- **The look follows docs/plan/capcut-ui-spec.md** where this work owns it: the headers' columns (123 px, open), the toggles' chips and order, the marker tag and box, and the rows' heights (main 76, overlay video 52, audio 50, the rest 24). The ruler (28 px against CapCut's 18), the 50 px before time 0 and the clip colours are the shell's, and still as before.
- **Links**: a detached audio is linked to its video (`linkId`): they move, trim, split and delete together; Unlink and Link in the clip menu; the Linkage toggle (`) edits clips alone. The engine now draws a detached video: its copy of the project reads the halves from the file itself, the video half silent (`withOriginalMedia`).
- A press on a trim handle no longer reorders the store's clips, an invisible change undo kept. The playhead's handle, let go, stays on the frame under it (snapping to markers and clip edges) instead of the ruler's tick grid, two frames or more apart on a long timeline zoomed in.
- Every edit is one undo step; markers, locks and the magnet are in what the history keeps and the autosave writes. The toolbar's buttons and toggles (`components/timeline/TimelineTools.tsx`), the header controls (`TrackControls.tsx`) and the markers (`Markers.tsx`) are standalone components, so they drop into the new layout.
- Checked in the app with `tl-suite.mjs` (README): each behaviour, each edit undone and redone with the engine's frame and the saved project compared, on the app's own project and on a CapCut draft's converted clips. `undo` and the Animation suite's app cases still pass.

## Addon API

Done:
- `openProject(path)` and `openProjectJson(json)` (OpenRip, v1 or CapCut `draft_info.json`).
- `setPreviewSize(w, h)`.
- `startPlayback(fromUs)` and `stopPlayback()`.
- `seek(timeUs)`.
- `frameForDisplay()` and `release(id)`.
- `positionUs()` and `setVolume(v)`.
- `updateProject(json)`: swaps in an edited project without reopening anything. Decoders of clips that still play the same file stay open; audio already mixed (~150 ms) plays out; paused, the current frame is rendered again.

- Types for all of it: `engine/crates/node/index.d.ts`.
- `thumbnails(path, timesUs, height, exact)` and `setThumbnailCacheDir(dir)`: timeline strips, quick (one keyframe per GOP) then exact, with exact ones kept on disk. Same two-step shape as the app's `getNearestCachedCanvasSamples` then `fetchCanvasSamplesStream` in `generateTimelineThumbnailVideo.ts`.
- `waveform(path, perSecond)`: peak and RMS per bucket of the mono mix, kept in the same cache folder. The app decodes whole files with `AudioContext` in the renderer today and holds every sample (115 MB for 10 minutes); this is 8 bytes per bucket, 0.1 ms from the cache.
- `beats(path)` (kept in the same cache folder) and `loudness(path, startUs, durationUs)`, for beat markers and Normalize loudness; `startRecording(path)`, `recordingLevel()`, `stopRecording()` and `useToneInput()` for the voiceover ("Audio tools" above).

To add:
- A push channel for the clock, to save polling.

## Risks

- `sharedTexture` is experimental in Electron 44. The fallback, measured in the frame-transport spike, is a native CALayer under a transparent window region.
- ~~`contextIsolation` with `sharedTexture`~~: verified in the spike (step 4).
- Feature gaps against the current preview: effects, transitions. The engine renders what CapCut drafts mostly use (video, photos, text with stroke and background, opacity, transforms). The rest comes in order of use.
