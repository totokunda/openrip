# Speed: curves, reverse and freeze frames

CapCut's speed tools as OpenRip has them: the Speed tab's Curve, and the timeline toolbar's Reverse and Freeze. Constant speed (Normal) was already there ([calibration.md](calibration.md), the mixer's atempo). The curve maths was read from CapCut 9.5.0's own engine (`libcccreator`, `libvideoeditor`, `libVECreator`, `libsamicore`) to learn it, not copied. Drafts are numbered, not named.

## What the local drafts use

A survey of all 68 drafts' `draft_info.json`:

| Tool | Drafts | Clips | Notes |
|---|---|---|---|
| Curve speed | 0 | 0 | Every `speeds` material is `mode` 0 with `curve_speed: null`. One cached cloud draft (not a local one) has a curve, used below for the mean speed. |
| Reverse | 2 | 2 | One clip is a compound clip whose files CapCut encrypts (unreadable); the other is on a hidden track. |
| Freeze | 2 | 4 | All four have CapCut's still in the draft folder; one draft's source video is on this machine. |
| Constant speed ≠ 1 | 8 | 32 | Unchanged by this work (below). |

So there's no CapCut export of a curve or of a visible reversed clip to compare frames with. What's checked against CapCut directly is the maths (to the bit, against CapCut's stored values), the reversed copies CapCut makes, and the freeze stills.

## Curve speed

### CapCut's maths

- **Points.** `speeds[].curve_speed.speed_points` are `{x, y}`: x the progress through the clip's source range (0 at the in-point, 1 at the out-point, in the order it plays), y the speed there. A curve counts when `mode` is 1; a normal speed can keep its last curve unused.
- **Where points sit in time.** CapCut places point i at output progress s_i = S_i / S_n, with S_i = Σ Δx / mean(y_prev, y) over the spans before it, in single precision (`VECurveSpeedUtilsImpl::transferTrimPointXtoSeqPointX`).
- **The speed between points** is an S-shaped ramp of three straight pieces over output time (`TECurveSpeedUtils::getCurveSpeedRatioWithSeqDelta`), with K1 = 0.8f and K2 = 0.2951f: the outer pieces make 10% of the change each over 20.49% of the span, the middle piece 80% over 59.02%. It's symmetric about the span's middle, so each span plays its source in the time its mean speed would: point i's source is reached exactly at s_i. Past the last point the speed is 1. It stays within 1% of the change of a smoothstep.
- **Source at a time** (`mapSeqDeltaToTrimDelta`): the exact integral of that speed, rounded to the µs; mirrored for a reversed clip after the mapping, so the curve runs along the clip as it plays. The inverse (`mapTrimDeltaToSeqDelta`) solves each piece's quadratic.
- **Length.** The mean speed is Σ mean(y) · Δs, which is 1 / Σ Δx / mean(y). CapCut stores it as the speed material's `speed`. The source is trunc(mean × target) and the target trunc(source / mean).
- **Keys** on a curved clip are in source time; CapCut places them on the timeline by the inverse map and snaps a key within 1 ms of either end to it.
- **Cutting** a curved clip: the speed at the cut is a smoothstep between the points beside it, in source progress, and each half's points are scaled to its own source (`VideoUpdateSpeedUtils::splitCurveSpeedPoints`).
- **Sound.** A curved clip's sound always goes through CapCut's varispeed (`TEAudioCurvePitchTempo` → `mammon::AudioScratching`): a read pointer stepping by the ratio, linearly interpolated, so **the pitch follows the speed**. "Change pitch" (`is_tone_modify`) applies only to constant speeds. The ratio is updated per 1024-sample block at 44.1 kHz from the map's secant.
- **Range.** 0.1×–10× (10× only on clips of a second or more of source). A new custom curve is five points at 1×.
- **The panel's drawing** is a cubic bezier per span, not the ramp; only playback uses the ramp.

### Presets

CapCut downloads its presets (effect type 37); they were read from its preset cache.

| Preset | Resource | Points (x, y) | Mean speed |
|---|---|---|---|
| Custom | 6768730851543880206 | (0,1) (.25,1) (.5,1) (.75,1) (1,1) | 1 |
| Montage | 6768648600848175619 | (0,.9) (.1,.9) (.5,6.8) (.65,.3) (.8,1) (1,1) | 1.453 |
| Hero | 6768650238149267981 | (0,1) (.05,1) (.35,5.5) (.45,.5) (.55,.5) (.65,5.5) (.95,1) (1,1) | 1.814 |
| Bullet | 6768731518358524430 | (0,5.2) (.4,5.2) (.46,.5) (.54,.5) (.6,5.2) (1,5.2) | 2.809 |
| Jump Cut | 6768731594225095175 | (0,.6) (.43,.6) (.5,6) (.57,.6) (1,.6) | 0.678 |
| Flash In | 6768731653402530307 | (0,5.2) (.4,5.2) (.6,1) (1,1) | 1.847 |
| Flash Out | 6768731733484376589 | (0,1) (.4,1) (.6,5.2) (1,5.2) | 1.847 |

### In OpenRip

- `engine/crates/model/src/speed.rs`: `Remap` (the ramp, the integral and its inverse in closed form, the mean speed in CapCut's single precision) and `CURVE_PRESETS`. A segment plays by the curved `Speed` among its attachments (`Segment::media_time`, `local_of_played`); frames come from the remapped time, scaled to the segment's own source length so a clip rounded to frames or cut from a curved one stays inside its source.
- The importer reads `mode`, the points and the preset's name, and places a curved clip's keys by the inverse with CapCut's 1 ms snap.
- The mixer plays a curve varispeed (`Mixer::curved`), sample by sample at the remapped source time.
- The app: `lib/speed.ts` has the same maths (its golden values are the engine's, in both test suites), the presets, CapCut's cut, and the store operations' patches ([app-engine-integration.md](../plan/app-engine-integration.md), "Speed tools").

### Checks

- **Mean speed against CapCut's own:** a cached draft stores `speed` 0.742763028661908 with a four-point curve; `Remap` gives 0.742763028661908 (to 1e-15), and a 2.7 s clip of it 2,005,460 µs of source against the draft's 2,005,458.
- **The engine and the app agree** on every preset's mean speed, source at 0.3, timeline at 0.3 and speed at 0.37, to 1e-12.
- Points are reached at their place, the speed is continuous where the pieces meet, time never runs backward, and the two directions agree to a few µs.
- The preview engine picks each frame by the remap (a barcoded clip on Flash In); the mixer's pitch follows the speed with "change pitch" on or off (440 Hz at 1×, 5.2 × 440 Hz at the end of Flash Out).
- In the app (harness step `speed`): Flash In set through the store gives the clip its media over the mean speed (151 frames from 278), and a frame shows the media `sourceTimeAt` gives.

## Reverse

### CapCut

Reversing a clip runs a job that renders a copy of its media played backward into the draft folder, the material's `reverse_path` (`##_draftpath_placeholder…##/<hash>.mp4`), with its sound. The copy is the media mirrored in time:

- Its frames are re-timed to the project's rate (a 24 fps clip's copy is 30 fps), each showing the media at `D − t`, where `D` is within a frame of the media's length (its frames matched against the original's across the whole copy).
- Its sound is the media's played backward, starting at the end of the media's audio (correlation 0.9994; the copy has an AAC encoder's 1024 samples of padding at its end).
- A freeze's `freeze` has a `reverse_material_path` too (empty in the local drafts).

### In OpenRip

- `Media::reverse_path` is imported (placeholder paths resolved). Where the copy is readable, a reversed clip reads it forward, picture and sound, mirrored about the media's `duration`.
- Without one (OpenRip's own reversed clips, a draft copied without its folder), the preview reads the media itself: while the clip plays or exports, from `ReverseReader` (`media/src/reverse.rs`: windows of frames decoded ahead on a worker, from the keyframe at or before each window's start, each answering a time with the frame shown then, as `frame_at` does); paused, seeking or dragging, from the decoder as any clip. The same frame for the same time either way. Windows hold 256 MB each (two at once); in a preview surface they're decoded at the preview's size where VideoToolbox can shrink as it decodes.
- The sound is read backward from the out-point, then through the clip's speed change like forward sound (pitch kept unless "change pitch"), as CapCut's copy goes through it.
- The app keeps a reversed clip's trims in the order it plays (`trimStart` from the media's end), so its split, trim and resize rules work unchanged.

### Performance

`openrip-dev pipeline-bench` (the render-ahead preview at 960×540, 11 s at 24 fps; Apple M2 Max):

| Clip | Forward | Reversed | Reversed on 9b8e76f1 |
|---|---|---|---|
| 4K ProRes HQ (the local clip) | 265 of 264 frames, 0 dropped, longest gap 56.6 ms | 265, 0 dropped, 56.7 ms | 145 shown, 57 late |
| 4K HEVC, keyframe every 60 frames | 265, 0, 58.1 ms | 263, 1 dropped, 128.9 ms (the first window) | 265, 0, 57.7 ms |

In the app, the reversed 4K ProRes clip draws 42 frames in 2 s of playback (harness `speed`). Dragging the playhead over a reversed clip uses the scrub stand-ins as before (`seek-bench --scrub`: quick frames p50 2 ms, p90 8 ms).

### Checks

- `ReverseReader`: every frame of every decode fixture (B-frames, open GOP, HEVC 10-bit, 29.97, MPEG-TS, VFR, ProRes) stepping backward from anywhere inside each frame, with windows inside a GOP and across GOPs, in native VideoToolbox, FFmpeg's hwaccel and software; random jumps and hops give the same frame as `frame_at`.
- The preview engine plays a reversed clip frame for frame as it shows it paused; the mixer reverses sound and keeps its pitch through a speed.
- In the app: 1 s into a reversed clip shows the frame 1 s before its end did, and ⌘Z puts it back exactly.
- **Not checked against CapCut:** whether a reversed clip's `source_timerange` is in the media's time (as OpenRip reads it: the clip shows `source.end` back to `source.start`) or in the copy's. Both local reversed clips end at the media's end, and neither can be compared with an export (one encrypted, one hidden).

## Freeze

### CapCut

Freeze cuts the clip at the playhead and puts a still of the frame there between the halves, 3 s long; the rest of the clip follows 3 s later, and the still's segment keeps the clip's attachments (from a draft: left half 15.208–16.5 s of source, a 3 s still, right half from 16.5 s, 3 s later on the timeline). The still is a picture CapCut saves in the draft folder (`<hash>_<µs>-hlg.png`, or `-sdr709.jpg`), a `videos` material of type `photo` named "Freeze" with `freeze: { source_material_id, source_material_path, reverse_material_path, timestamp }`. `timestamp` is the cut, truncated to the µs; the still is the frame starting there, which CapCut's frame lookup finds by snapping to a frame's start within 0.8 ms (the file is named for that frame's start).

### In OpenRip

- `Media::freeze` (`video`, `at`): the importer reads CapCut's, with the video by its material's path and `at` 0.8 ms past `timestamp`. CapCut's still is drawn as before; a still that's missing, and OpenRip's own freezes (no picture), are drawn from the video at `at`. Freezes have no sound.
- The app: `freeze: { at }` on a video clip; `freezeFrame(clipId, frame)` in the store (lib/speed.ts), as CapCut's.

### Checks

- **The video's frame against CapCut's still:** on the draft whose source video is here, the freeze drawn from the video is 49.6 dB from the one drawn from CapCut's JPEG (22.5 dB before the 0.8 ms snap: the frame before). The still matches the video's frame at the cut at 37.9 dB, its neighbours at 22–23 dB.
- The drafts' freezes draw exactly as before (their stills).
- In the app: a freeze at 2 s holds that frame for 3 s, the rest of the clip shows 3 s later, the project saves the still; an export is silent through it (RMS 0) and its sound after it is the clip's from 2 s, 3 s later (the best lag 0, searched in quarter milliseconds).

## Drafts that don't use these render as before

Against a build of 9b8e76f1, where this work started (and the first three again against main with the transitions and clip animations, 76feb983, after rebasing on it: the same):

- `cover-parity` over the 32 drafts with media: the same numbers (p50 33.8 dB).
- `app-roundtrip`: all 35 compared drafts at 138.1 dB.
- `preview-scan`: its 340 frames byte-identical.
- `export-parity --every 1` on the draft with the hidden reversed clip and a CapCut export: all 108 samples identical (p50 45.1 dB).
- `mix` on the 10 drafts that use any speed tool (32 clips at constant speeds, the reversed clips, the freezes): byte-identical WAVs.
- `pipeline-bench` and `seek-bench --scrub` on the 4K clip forward: the same (265 frames shown, none dropped, longest gap 56.6 ms against 57.6 ms; drag p50 3 ms, p90 17 ms against 18 ms).

## Not done

- **Smooth slow motion** (CapCut's frame interpolation for slow curves and speeds): frames are held, not blended or interpolated.
- **Discrete curves** (`TEDiscreteCurveSpeedUtil`, a repeating step function CapCut picks on a flag drafts don't set) and `is_reverse_curve_speed`.
- **Keyframed speed ramps** ("variable speed animations" from keyframes): none locally.
- The varispeed's ratio is the map's exact slope per sample, where CapCut's is the secant over 1024-sample blocks at 44.1 kHz: the same at block edges, within a fraction of a percent between them.
- The reversed copy is read mirrored about the material's `duration`, where its picture mirrors about the video's last frame and its sound about the audio's end: up to a frame and about 14 ms off on the one local copy.
- The source-range convention for reversed clips (above), and clip animations on reversed or curved clips: they run in timeline time, as on other clips; CapCut's behaviour there is unchecked.
- A calibration session (a curve preset per clip, a visible reversed clip, a freeze from the toolbar) would check all three against CapCut's export.
