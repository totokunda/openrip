# Transitions

The local drafts use three of CapCut's transitions, 8 times, all with exports: Blink (5), White Flash (2) and White Fade (1). OpenRip draws all three from what their bundles' scripts do, checked against the exports frame by frame.

## Timing

A transition attached to a clip runs across the cut to the next clip on its track, from half its duration before the cut to half after it, whether or not CapCut marks it as overlapping. The draft keeps the clips butted. Its scripts see a progress `p` from 0 to 1 over that window (`Amaz.Input.frameTimestamp`).

Transitions work on the clip, not on what's above it: captions and other tracks stay as they are (a White Flash leaves the text on top visible).

## The three

| Transition | Resource | Script | What it does |
|---|---|---|---|
| White Flash | 6724845376098013708 | `SeekModeScript.lua` | The frame mixed towards white by 2p, then 2(1 − p): all white at the cut. |
| White Fade | 7637430135737650452 | `scriptScene.js` (three.js) | On a 2 s timeline: white rises linearly 50–800 ms, holds to 1200 ms, falls by 1950 ms; the clips cross-fade 750–1250 ms. White is (brightness − 1) / 1.2 of a brightness going 1 → 2.2. |
| Blink | 6864867302936941064 | `Set.lua` | 120 frames of black eyelids (`seq/1/1_00N.png`, 1200×675), closing over the outgoing clip (frames 1–60) and opening over the incoming one (61–120), cover-fitted to the canvas; under them the clip is blurred with taps 1.25 × 3(q − 0.6) px apart while the eye is at least 60% shut. |

The White Fade's cross-fade happens under at least 93% white, so OpenRip switches clips at the cut instead of mixing them: at most 7% of the difference between the clips, for a quarter of the transition.

## Checks

Mean brightness of the export through a White Flash (0.5 s, 24 fps) against `mix(frame, white, amount)`: 121.0 / 200.7 / 255.0 / 204.7 at four frames, OpenRip 121.1 / 200.7 / 255.0 / 204.6. The White Fade's window fits the same way (e.g. 151.3 measured, 152.5 predicted a sixth of the way in).

Export parity on the samples inside the windows ([results](results/2026-10-16-transitions.md)): White Flash 4.3–18.8 dB → 24–138 dB (138: both pure white), White Fade 3.4–11.8 dB → 31.0–32.6 dB, Blink 16.9 → 57.5 dB where the eye is shut; the rest of the windows sit at the clips' own scores.

## Still open

- Overlapping transitions that need both clips at once (a real cross-fade, a wipe): CapCut plays the outgoing clip past its end and the incoming one before its start. None in the local drafts yet.
- CapCut's other transitions; built-in ones for new projects.
