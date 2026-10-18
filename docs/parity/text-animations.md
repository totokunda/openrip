# Text intros

The local drafts use library text intros on 85 clips. The three typing intros OpenRip now draws cover 35 of them; the other 50 are mostly a caption style (43) not drawn yet.

| CapCut name | Resource id | Clips | OpenRip |
|---|---|---|---|
| (caption style) | 7289356246623195649 and two others | 43 | not yet |
| Type 2 | 6724920636403094028 | 27 | `type_2` |
| Typewriter | 7210980292243231233 | 5 | `typewriter`, without the caret |
| Type 1 | 6724920249654710791 | 3 | `type_1` |

Each animation is a small script bundle that CapCut downloads into its cache; the draft records the bundle's path. The timings below come from reading those scripts on this machine (read only; nothing of CapCut's is copied into the repo). `openrip-playback::animation` reimplements them. *n* is the number of characters, counting spaces and line breaks; *D* is the animation's duration; character *i* runs from 1 to *n*.

- **Type 1.** Character *i* appears at once at *D*·*i*/(*n*+1).
- **Type 2.**
  - Character *i* fades in with a sine-in curve, 1 − cos(π/2·*p*).
  - The fade starts at ¾*D*·(1 − cos(π/2·*i*/*n*)).
  - It lasts ¼*D*·(1 − (1 − *i*/*n*)⁵).
  - The result: early characters arrive quickly and almost together, and the last starts at ¾*D* and ends at *D*.
- **Typewriter.**
  - Each character gets a slot in proportion to a fixed 14-step rhythm (0.86, 1.35, 0.62, 2.2, 0.25, 0.96, 0.35, 2.55, 0.03, 0.82, 0.2, 1.26, 0.36, 0.1), repeated. When there is under 0.15 s per character, steps 4 and 8 are 5.2 and 4.55 instead.
  - The slots fill the first 1/1.2 of the animation, and a character appears 90% of the way through its slot.
  - CapCut also draws a blinking caret (a white bar from the bundle) after the last character shown. Not drawn yet.

Opacity applies per character to the fill and the stroke. The background box stays.

**Checks:**
- **Covers.** CapCut's draft covers render the first frame with the animation applied: the drafts that open on a Type 2 caption have none on their cover, as the timing above predicts.
- **Calibration session 5.** CapCut's export confirms all three timings: Type 1 frame for frame, Type 2 to an rms opacity of 0.002, and Typewriter's every reveal frame at 2 s and at 1/3 s. The caret it measures (size, position, when it shows) is in [calibration.md](calibration.md#session-5-text-intros-and-line-wrapping).

Text Out animations (fades, zooms, slides) and Loops are clip moves, drawn like a video's: [clip-animations.md](clip-animations.md).
