# Motion: tracking, Optical flow and Smooth slow-mo

CapCut's motion tools as OpenRip has them, built with classic (non-ML) algorithms (the rule in [capcut-ui-spec.md](../plan/capcut-ui-spec.md) §6's preamble; the rows are §6.31): the Tracking tab of a text, sticker or photo, the Mask tab's Track mask, Speed ▸ Smooth slow-mo and Video ▸ Basic ▸ Optical flow. CapCut does all four with learned models; OpenRip does the same jobs with motion estimation in its own engine. Drafts are numbered, not named.

## Where the code is

| Part | Where |
|---|---|
| Motion estimation (pure Rust, no dependencies, every target) | `engine/crates/motion`: pyramids and gradients, Shi–Tomasi corners, pyramidal Lucas–Kanade, RANSAC similarity and affine fits, the region tracker, dense flow and interpolation on the CPU |
| Dense flow and in-between frames on the GPU | `engine/crates/render/src/flow.rs`, `flow.wgsl` (`Source::Tween`) |
| In-between frames in the preview and the export | `engine/crates/playback/src/preview.rs` (`tween_mode`, `Pixels::Tween`) |
| Tracking a region through a video | `engine/crates/core/src/track.rs` (`track_region`, `TrackControl`); the addon's `trackRegion`, `trackProgress`, `cancelTrack` |
| The project's flags | `engine/crates/model` (`Media::complement_frame`, `smart_complement_frame`); CapCut import in `engine/crates/capcut`; the app's fields in `engine/crates/v1` |
| The panels | `components/properties/TrackingProperties.tsx`, `mask/TrackMaskSection.tsx`, `SmoothSlowMo.tsx`, `OpticalFlowProperties.tsx`, `components/preview/TrackingRegion.tsx`; `lib/tracking.ts` (geometry, keys) and `lib/tracking-run.ts` (the engine call) |
| Measuring on real footage | `openrip-dev slowmo` and `openrip-dev track` |

## How CapCut stores them

Read from the local drafts (read only) and CapCut 9.5.0's model library (`libvideoeditor`), to learn the names, not copied:

| Feature | CapCut's draft | OpenRip's model | The app's clip |
|---|---|---|---|
| Smooth slow-mo | `materials.videos[].video_algorithm.complement_frame_config`: `null`, or `{"mode": "optical_flow" \| "frame_blending"}`; with it an `algorithms[]` entry of type `ComplementFrame` and the pre-rendered result (`path`, `time_range`) | `Media::complement_frame { mode }` | `smoothSlowMo: { mode } \| null` |
| Optical flow (Basic) | `video_algorithm.smart_complement_frame`: `null`, or `{"fps": 60, "sub_type": 0}` (draft 60 has it on 84 materials) | `Media::smart_complement_frame { fps, sub_type }` | `opticalFlow: { fps } \| null` |
| Motion tracking | `materials.video_trackings[]` linked from the segment: `config {center_x, center_y, width, height, rotation}`, `enable_scale`, `enable_relative_distance`, `tracking_time_range`, `trackers[]`, `result_path` (CapCut's own result file), `track_covert_keyframe` | keyframes on the segment's transform | `keyframes.position` (and `scale`, `rotation`), with `tracking` (the tab's settings and region) |
| Track mask | `common_mask[].track_segment` / `video_mask[].track_segment` (empty in every draft) | the mask's keyframes | the mask's keyframes |

CapCut keeps its flags on each clip's video material, so a clip in the app that sets either flag plays its own copy of the media flagged, and other clips of the asset are untouched. Tracking ends up as keyframes on the clip (CapCut can convert its tracking to keyframes too, `track_covert_keyframe`), so tracked keys are edited like any others. Only draft 24 has a tracking material, switched on but never run (no result), so there's no CapCut tracking result to read.

## Tracking

**Method.** The region (drawn on the canvas, turned into fractions of the video's upright picture through its transform at the playhead) is followed through the video's real frames from that frame, forward, back or both. Each frame is decoded and drawn upright and grey by the compositor, at the size that gives the region about 160 pixels on its short side (640–1920 px on the frame's long side). In the region, up to 160 Shi–Tomasi corners are tracked by pyramidal Lucas–Kanade (15×15 windows, four levels, from where the last motion predicts), each checked by tracking it back (1 px). A similarity (position, uniform scale, rotation) is fitted to the survivors with RANSAC: against the points' first positions while that fit agrees with at least 80% of them (no drift), else frame to frame (an object that changes shape). Corners are refilled when fewer than half remain. Tracking is lost when fewer than five points, or a quarter of those tracked, agree, or the region leaves the picture; the clip then keeps its last good place.

**Keys.** Every timeline frame where the clip and the video overlap gets the region's place, size and turn at the source time that frame shows (through the video's speed, curve or reverse and its own keyed transform). The clip keeps its offset from the object where the region was drawn; Distance scales that offset with the object, Scale scales the clip, and Rotation (not one of CapCut's options) turns both. Keys a straight line between its neighbours misses by less than 0.25 world units (0.002 of scale, 0.2°) are left out. A mask's poses are keyed the same way on its own clip.

**Accuracy and speed.**

| Test | Result |
|---|---|
| Synthetic: a textured square moving 3.1 px, growing 1.2% and turning 1.5° a frame over a textured background, 30 frames (`motion` crate) | within 0.5 px, 1% of scale and 0.5° (asserted; worst values printed by the test) |
| Synthetic, encoded: a square moving 4 px a frame in an H.264 clip, tracked both ways from its middle (`core/tests/track.rs`) | 0.00 px worst over 48 frames; cancel stops it |
| The face in the 4K ProRes test clip, forward from the start | 278 frames at 27 fps (decoding included); a round trip to the end and back returns within 8.9 source px (0.23% of the frame's height), 1.3% of scale and 2.9° |
| In the app (`tracking` step): the face tracked, the text's motion against the face found by block matching in the engine's frames | agrees within 0.5–1.2 px at the preview's size |

**Against CapCut.** CapCut's tracker is a learned model and its draft keeps only the region and a result file, so there's no frame-for-frame comparison. What the classic tracker does as well: textured objects that move, scale and turn, at the source's real frames. What it does less well than a learned tracker: objects that change appearance a lot (a head turning away), long full occlusions (tracking stops, it doesn't re-find the object), and regions with little texture (it refuses them: "the region has no detail to track").

## Optical flow and Smooth slow-mo

**When.** Smooth slow-mo works while a clip plays slower than its source (its speed, or a curve's slow stretches), as CapCut's "Only slow-speed videos are supported"; Optical flow (Basic) works at any speed. A frame within 2% of a source frame shows it; otherwise it's made from the two source frames around its time: blended (Frame blending) or moved along their motion (Optical flow). Not while the playhead is dragged. The preview and the export both draw it; the flow is worked out once per pair of source frames and kept, so the frames between them (four at 0.25×) cost only the final pass.

**Flow.** Dense pyramidal Lucas–Kanade on the GPU, on fragment passes with explicit texel loads (portable to WebGPU and GLES): at up to 960 px on the long side, six levels; the coarsest level starts from an exhaustive search (±4 px there, ±128 px at the working size); at each level every pixel first takes whichever of its own and its neighbours' vectors matches a small patch best, then robust Lucas–Kanade steps (7×7 Gaussian window moved by the pixel's vector, window pixels weighted down as their brightness difference grows, regularised, a pixel at most a step), a neighbour selection again and a 3×3 median. Both ways (A→B and B→A).

**Frames between.** Each pixel finds the motion through it by fixed-point iteration from each flow and keeps the one whose ends match better; each end is weighted by t and by whether the other end sees it (the forward–backward check), so a region uncovered between the frames comes from the frame that shows it. Where neither end checks out, or both do but don't look alike, it falls back to a cross-fade.

**Accuracy.**

| Test | Optical flow | Frame blending | Holding frames |
|---|---|---|---|
| Synthetic: a textured square moving 18 px and turning 4° between frames 0 and 2, frame 1 held out (240×180; the GPU's flow matches the CPU reference to 0.01 px) | 32.2 dB | 25.5 dB | – |
| The same at 1200×900 (45 px between frames at the working size) | 31.3 dB | 25.3 dB | – |
| A texture panning 8 px a frame at 30 fps played at 0.25× through the preview, against the same motion filmed at 120 fps (`playback/tests/slowmo.rs`) | 42.3 dB | 31.1 dB | 29.7 dB |
| The 4K ProRes test clip: a real frame rebuilt from its neighbours, 8 places (`openrip-dev slowmo --holdout 8`, at 960×540) | 41.0 dB | 38.2 dB | 35.6 dB |

**Speed** (Apple M2 Max, the machine shared with other builds):
- `openrip-dev slowmo` on the 4K ProRes clip at 0.25×, rendered at the preview's 540×960: 83 frames/s with optical flow (p50 3.5 ms; a frame that starts a new pair of source frames decodes one and works out the flow, p95 41 ms), 159 with blending, 138 holding frames.
- The app (`slowmo` step): playback draws 23.6 frames a second on the 24 fps project with Smooth slow-mo on; the 46 s clip at 0.25× exports in 23 s at the dialog's default 480×854.
- The flow alone from two 4K frames (uploads included): 24 ms, the best of 12 (`render/tests/flow.rs`, `flow_timing_at_4k`).

**Against CapCut.** CapCut renders its Smooth slow-mo ahead with a learned model into a file (`video_algorithm.path`), so the clip has to process before it plays smoothly; OpenRip's is drawn live and plays in real time from 4K. A learned interpolator handles large motion, thin structures and occlusions better. The classic flow does well on textured motion up to tens of pixels between frames and falls back to blending where its checks fail, but a purely periodic pattern (stripes, a fence) can lock onto the wrong period, and then the made frame is worse than a blend.

## Not done

- CapCut's tracking result files (`result_path`) and its pre-rendered slow-mo files aren't read: drafts with tracking run (none locally) import without it, and Smooth slow-mo on an imported clip is drawn by OpenRip.
- Track mask tracks shape masks on a video clip; a draft's adjustment layer's mask isn't tracked (the app has no adjustment layers of its own).
- The app's own preview (with the engine off) doesn't draw keyframes, so tracked motion shows in the engine's frame.
- Mask keys are at the app's frames from the clip's in-point (`getLocalFrame`), the convention its mask keys already use; the engine reads them from the clip's start, so on a trimmed clip the two differ (an existing difference, not one tracking adds).
