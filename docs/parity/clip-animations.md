# Clip animations

CapCut gives every clip In and Out animations, video and photos a Combo, and text and stickers a Loop. OpenRip draws a basic set of them on video, photos and text since 2026-10-18, as built-ins any project can use. The local drafts animate no video or photo (their 93 animation materials are text intros and caption styles; [text-animations.md](text-animations.md)), so CapCut's own bundles for these are mostly not on this machine: only the video Fade Out's is.

## How CapCut stores them

A draft's `material_animations` holds one item per animation on a clip: `type` ("in", "out", "group" for a video's combo, "loop" for text), `resource_id`, `name`, `duration` (µs), `start`, `material_type` ("video" for video and photos, "sticker" for text), `panel`. An Out animation has `start` 0, like an In: CapCut runs it up to the clip's end, so the engine ignores its start. The importer reads "group" as the model's `Combo`.

## CapCut's animation template

The video Fade Out (6798320902548230669, in a draft in a cloud cache) is a small bundle around `Transform.lua`, a general template: a list of actions, each a property going from one value to another over part of the run (`startTime`, `endTime` as fractions) on a cubic bezier (`getBezierTfromX`, solved by bisection, then `getBezierValue`):
- a position (in units of half the canvas height, x times the canvas's aspect: so half-canvas units on each axis),
- a scale, an Euler turn (degrees),
- an opacity (`_alpha` on the clip's blend material),
- a motion or zoom blur (`blurStep`, its shader in `xshader/gles2_filter.frag`).

Fade Out's values: opacity 1 → 0, linear (bezier 0, 0, 1, 1), over the whole run; nothing else moves.

How it sits on the clip (`updateHandle`): the clip's own transform is on the parent ("Root"); the animation's goes on the picture below it, composed as translate(user position + animation offset) · animation turn and scale · user turn and scale. So the offset adds to the clip's position, the scale and turn apply about the clip's centre after its own, and the opacity multiplies. A clip with keyframes has its keyed values there, and the animation sits on top. Newer bundles (Blurred Fade-in, 7473710407329255953, an After Effects export with `videoAnimationBase`) compose the same way (`userMat` from the clip's position, angle and scale).

## What OpenRip draws

`openrip-playback::animation::motion_at` gives an offset, scale, turn and opacity from a clip's animations at a clip-local time; the preview applies them on top of the sampled transform (video and photos through their placement, text by moving, scaling and turning its picture). An In runs from the clip's start; an Out up to its end; a Combo once over its run; a Loop over and over, once per its duration. Several add up (an In over a Combo). Before an In's start (the incoming clip of a mixing transition) it holds its first state, after an Out's end its last. Clips without animations take no extra work.

Fade Out is CapCut's. The others are the template's moves with our values, until their bundles are on hand ("named" in `lib/animations.ts`). Eases are cubic (out for In, in for Out); a slide travels one canvas (two half-canvas units); slides are named by the way the clip moves ("slide_left" comes in from the right, or leaves to the left).

| Kind | Built-in | Motion |
|---|---|---|
| In | `fade_in` | opacity 0 → 1, linear |
| In | `zoom_in` | scale 0.5 → 1 (ease out), opacity 0 → 1 over the first half |
| In | `zoom_out` | scale 1.5 → 1, opacity as above |
| In | `slide_*` | from a canvas away against the direction (ease out) |
| In | `rotate` | −180° → 0 (ease out), opacity 0 → 1 |
| In | `spin` | −360° → 0 and scale 0 → 1 (ease out) |
| In | `bounce` | scale 0 → 1 on cubic-bezier(0.34, 1.56, 0.64, 1): past full size by up to 10%, back |
| In | `shake` | sideways 0.04 · sin(6πq) · (1 − q) |
| Out | `fade_out` | opacity 1 → 0, linear (CapCut's) |
| Out | `zoom_in` | scale 1 → 1.5 (ease in), opacity 1 → 0 over the second half |
| Out | `zoom_out` | scale 1 → 0.5, opacity as above |
| Out | `slide_*` | to a canvas away in the direction (ease in) |
| Out | `rotate` | 0 → 180° (ease in), opacity 1 → 0 |
| Out | `spin` | 0 → 360° and scale 1 → 0 (ease in) |
| Out | `bounce` | the In's curve backwards: swelling by up to 10%, then shrinking to nothing |
| Out | `shake` | sideways 0.04 · sin(6πq) · q |
| Combo | `swing` | 8° · sin(4πq): two swings over the clip |
| Combo | `shake` | sideways 0.03 · sin(16πq) |
| Combo | `pulse` | scale 1 + 0.1 · sin²(2πq): two beats |
| Combo | `spin` | one turn, ease in-out |
| Loop | `pulse`, `swing`, `shake` | one beat, swing or four shakes per round |
| Loop | `float` | up and down, 0.03 · sin(2πq) |
| Loop | `blink` | opacity 0.5 + 0.5 cos(2πq) |

Text takes the typing intros ([text-animations.md](text-animations.md)) and `fade_in`, `zoom_in`, `zoom_out` and `slide_*` as In, those and `fade_out` as Out, and the Loops. Video and photos take every In, Out and Combo above.

The template's blurs (motion and zoom) aren't drawn yet; none of the built-ins uses one.

## Durations

As the app sets them (`engine/crates/v1`): an In and a Loop at most the clip's length, an Out in what the In leaves of it (ending with the clip), a Combo over the whole clip. A split keeps the In on the left half, the Out on the right one, and the Combo or Loop on both, each fitted to its half; a trim fits them the same way. A CapCut clip's animations come back exactly when the app doesn't change them.

## Import

By resource id: the video Fade Out. By English name and kind, where the id isn't known: Fade In (In) and Fade Out (Out). Anything else keeps its library reference, isn't drawn, and is listed in the report's `unmapped_library` ("animation: Swing (…)"). Over the local drafts that's 10 text intros of 7 kinds (Pousse clownesque, Preview Type, Glitter Horizon, Rebondissement, Type Slide, Wind & Release and one without a name); seen in a cloud-cache draft: Blurred Fade-in (video), Blow Up and Doodle II (stickers).

## Checks

There's no draft or export with these to compare against; what's checked:
- **The math:** unit tests of each built-in at several points, Fade Out against its bundle's values (`playback/src/animation.rs`).
- **The frames:** the preview engine on a quarter-size still moving across the canvas by keyframes: Fade In at a quarter second is half lit where the keys have it, Fade Out three quarters through a quarter lit, a slide adds a canvas to the keyed position, a pulse reaches pixels the clip doesn't cover at rest (`playback/tests/transitions.rs`).
- **In the app:** the harness step `transitions`: Fade In and Fade Out halfway through halve the frame's lightness (0.50 and 0.50); a split keeps the In on its left part and the frames as they were (0 pixels differ); a Swing combo turns the picture (66% of the pixels change) and spans its part; the saved project keeps the fields.
- **Unchanged drafts:** round trip at 138.1 dB, cover parity and the 340 preview-scan frames the same.

## Still open

- CapCut's values for everything but Fade Out: dragging each basic animation onto a clip once in CapCut caches its bundle, whose `Transform.lua` holds them; then a calibration export gives the numbers.
- The template's motion and zoom blurs.
- Sticker animations, and CapCut's fancier ones (After Effects exports like Blurred Fade-in: exposure, bokeh blur, grain).
