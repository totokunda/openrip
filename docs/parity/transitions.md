# Transitions

The local drafts use three of CapCut's transitions, 8 times, all with exports: Blink (5), White Flash (2) and White Fade (1). OpenRip draws all three from what their bundles' scripts do, checked against the exports frame by frame. Since 2026-10-18 it also draws the classic set as built-ins any project can use: Mix, Black Fade, Pull in, Pull out, Blur, Slide, Push and Wipe (four directions each), Circle and Spin. Of these only Pull in's bundle is on this machine; the rest follow CapCut's rules for timing and overlap with our own curves (below).

## Timing

A transition attached to a clip runs across the cut to the next clip on its track, from half its duration before the cut to half after it, whether or not CapCut marks it as overlapping. The draft keeps the clips butted. Its scripts see a progress `p` from 0 to 1 over that window (`Amaz.Input.frameTimestamp`).

Transitions work on the clip, not on what's above it: captions and other tracks stay as they are (a White Flash leaves the text on top visible).

## Overlapping transitions

A bundle's `extra.json` says whether CapCut overlaps the clips (`isOverlap`) and its default duration (`defaultDura`). Its script gets both clips as canvas-sized pictures (White Fade's `scriptScene.js`: `texture1`, the outgoing clip, and `texture2`, sized from `share://input.texture`). Most transitions still show one clip at a time with the cut at the middle: Pull in (not overlapping) switches clips when its eased progress reaches 0.5, which is at the cut, and Flash Split (overlapping) uses the outgoing picture for the first half of its timeline and the incoming one for the second (`ae_transitionInputIndex` and `texDuration` in its `LumiExportData.lua`).

The ones that show both at once (Mix, Slide, Push, Wipe, Circle) need the outgoing clip after its end and the incoming one before its start. OpenRip plays them on from their media at their speed, as far as the media goes (a video that runs out holds its last frame; a photo is the photo). Each clip is drawn into a group of its own the canvas's size, with its transform, masks and adjustments, and the transition puts the two together (`openrip-render`'s `Mix`: each group placed by an affine map, faded, the incoming one over the outgoing one inside a mask). With nothing under them the groups carry the canvas's black, as CapCut's main-track clips carry their canvas, so a push moves the black bars of a picture that doesn't fill the canvas with it. Clip animations apply inside the groups: an incoming clip drawn ahead of its start holds its In animation's first state, and an outgoing clip played past its end its Out animation's last.

## The transitions

| Transition | Resource | Source | What it does |
|---|---|---|---|
| White Flash | 6724845376098013708 | bundle, `SeekModeScript.lua` | The frame mixed towards white by 2p, then 2(1 − p): all white at the cut. |
| White Fade | 7637430135737650452 | bundle, `scriptScene.js` (three.js) | On a 2 s timeline: white rises linearly 50–800 ms, holds to 1200 ms, falls by 1950 ms; the clips cross-fade 750–1250 ms. White is (brightness − 1) / 1.2 of a brightness going 1 → 2.2. |
| Blink | 6864867302936941064 | bundle, `Set.lua` | 120 frames of black eyelids (`seq/1/1_00N.png`, 1200×675), closing over the outgoing clip (frames 1–60) and opening over the incoming one (61–120), cover-fitted to the canvas; under them the clip is blurred with taps 1.25 × 3(q − 0.6) px apart while the eye is at least 60% shut. |
| Pull in | 6724226861666144779 | bundle, `VerticalZoomNear.frag` | T = easeInOutQuint(p). Until T = 0.5 the outgoing clip is sampled at 0.5 + (uv − 0.5)(1 − T), so it zooms to twice its size by the cut; after it the incoming one at 0.5 + (uv − 0.5)(2 − T), from two thirds of its size back to 1. Outside the picture the coordinates are mirrored (abs, then 2 − x). Each clip is blurred towards the canvas centre: 21 taps at uv + 10/720 · i · (uv − 0.5) · 2 · b, b = T for the outgoing clip and 1 − T for the incoming one. Default 1 s, not overlapping. |
| Black Fade | 6724239388189921806 (from a draft's `key_value.json`) | named | White Flash's curve through black. |
| Pull out | — | named | Pull in played backwards with the clips swapped: the outgoing clip shrinks to two thirds, the incoming one settles from twice its size. |
| Mix | — | named | The incoming clip over the outgoing one at opacity p. |
| Slide (left, right, up, down) | — | named | The incoming clip slides in over the still outgoing one from a canvas away, on a cubic ease in-out. |
| Push (left, right, up, down) | — | named | Both move together, the incoming clip a canvas behind the outgoing one, same ease. |
| Wipe (left, right, up, down) | — | named | A straight edge crosses the canvas the way named (same ease, 2% past each side, 2% feather), the incoming clip behind it. |
| Circle | — | named | The incoming clip inside a circle growing from the centre to 1.2 canvas heights (past the corners of 9:16 and 16:9). |
| Blur | — | named | CapCut's transition blur over the canvas, taps up to 6 px apart (at 1080 wide) at the cut, eased. |
| Spin | — | named | The outgoing clip turns half a turn as it shrinks to nothing by the cut; the incoming one turns in from half a turn as it grows. |

"Named" means CapCut has a transition of that name (its Classic, Basic, Slide, Mask and Movement panels) but its bundle isn't in CapCut's cache here, so the curve is ours; the code says so where each is drawn (`openrip-playback::transition`). The White Fade's cross-fade happens under at least 93% white; OpenRip mixes the clips as its script does (its tween starting 10 ms after its delay) wherever the white isn't total, and shows one clip under total white, where the mix doesn't show. Until 2026-10-18 it switched at the cut instead, which differed by at most 7% of the difference between the clips for a few milliseconds either side of the hold: no frame of the draft's 24 fps export falls there, and its frames through the White Fade score the same either way (17 frames, p50 44.5 dB, worst 37.0 dB).

## Import

The importer maps a draft's transition by resource id (the first five above), else by its English name (Mix, Black Fade, Pull in, Pull out). Anything else keeps its library reference, is drawn as a cut, and is listed in the import report's `unmapped_library` ("transition: Flash Split (7460753045769425409)"); `capcut-scan` adds them up over every draft. All 9 transitions of the local drafts are drawn. Seen elsewhere on this machine (a cloud cache, a backup, a draft's `key_value.json`) and not drawn: Wispy Wipe, Flash Split, Basic Black, Glare II, Velocity Stretch, Faded Swipe.

## Checks

Mean brightness of the export through a White Flash (0.5 s, 24 fps) against `mix(frame, white, amount)`: 121.0 / 200.7 / 255.0 / 204.7 at four frames, OpenRip 121.1 / 200.7 / 255.0 / 204.6. The White Fade's window fits the same way (e.g. 151.3 measured, 152.5 predicted a sixth of the way in).

Export parity on the samples inside the windows ([results](results/2026-10-16-transitions.md)): White Flash 4.3–18.8 dB → 24–138 dB (138: both pure white), White Fade 3.4–11.8 dB → 31.0–32.6 dB, Blink 16.9 → 57.5 dB where the eye is shut; the rest of the windows sit at the clips' own scores. After the classic set went in (2026-10-18), the draft with the White Fade and both White Flashes scores exactly as before at every one of its 195 samples (every 0.125 s; p50 40.4 dB, worst 21.7 dB); the Blink draft's export is no longer on this machine.

The classic set has no draft or export to compare with. What's checked:
- **Pull in against CapCut's shader:** a CPU transcription of `VerticalZoomNear.frag` (zoom, 21-tap blur, mirroring, clamped bilinear taps) matches the GPU pass within 2/255 on a gradient and checkerboard (`render/tests/groups.rs`).
- **The math:** unit tests of each transition at several progress points (`playback/src/transition.rs`).
- **The frames:** the preview engine on two flat stills (a Mix a fifth and three fifths through, a Push and a Slide at the cut, a Wipe, a Black Fade, Pull in) and on a barcoded video, where a Mix six frames either side of the cut shows the outgoing clip's frame 54 with the incoming one's 144 (six frames before its start), then 66 (past its end) with 156 (`playback/tests/transitions.rs`).
- **In the app:** the harness step `transitions` (a Mix across its window, a Push and a Wipe at the cut).
- **Unchanged drafts:** every local draft converts to the app and back at 138.1 dB, cover parity is the same draft for draft, and the 340 preview-scan frames are byte for byte the same.
- **Cost:** frames inside a Mix or Push between two parts of the 4K ProRes clip take 16 ms at 540p (two decodes) against 8 ms outside; playback of a draft without transitions is unchanged (p50 3.4 ms, p95 4.6 ms, three runs each).

## Still open

- CapCut's own curves for Mix, Black Fade, Pull out, Slide, Push, Wipe, Circle, Blur and Spin. Dragging each onto a clip once in CapCut puts its bundle in the cache; reading it then replaces our curve, and an export of a calibration draft gives the numbers.
- CapCut's other transitions (Glare II, Wispy Wipe, Flash Split and the rest of its library).
- A mixing transition's groups carry black because that's all the preview draws under the main track today; once CapCut's canvas fills (colour, blur, image) are drawn, each clip's group should carry its own fill, as CapCut's clips do.
- Whether CapCut plays an overlapping transition's clips on from their media, as OpenRip does, or holds their end frames: no local draft has one with an export.
