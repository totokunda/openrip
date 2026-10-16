# Transitions — 2026-10-16

`openrip-dev export-parity <draft> <export> --every 0.125 --all` on the samples inside each transition window, before (transitions not drawn) and after. Draft A has a White Fade and two White Flashes, draft B five Blinks.

`export-parity` now also renders each sample at the export frame's own time instead of the sample time, which can be up to a frame later, so the "after" column includes that fix. It alone moves the medians from 26.3 to 31 dB: anything that moves was being compared a fraction of a frame off.

| Window (samples in order) | Before | After |
|---|---|---|
| A, White Fade | 11.8, 3.4, 7.9, 18.4 | 32.6, 31.0, 31.4, 23.9 |
| A, White Flash 1 | 18.8, 6.9, 5.6, 13.3 | 34.5, 33.4, 24.1, 25.3 |
| A, White Flash 2 | 32.4, 9.6, 4.3, 10.2 | 32.4, 31.5, 138.1, 25.3 |
| B, Blink 4 (eye mostly shut at the third) | 47.0, 46.4, 16.9, 47.1 | 47.0, 47.0, 57.5, 47.1 |
| B, Blink 5 | 29.3, 46.3 | 48.6, 46.3 |
| B, Blinks 1–3 | 17.1–21.2 | 23.7–23.9 |

The samples just after a cut (23.9–25.3 dB) score the incoming clip's own level outside the window too; 138.1 dB is both frames pure white. Draft A's worst sample goes from 3.4 to 20.5 dB, draft B's from 13.5 to 23.7 dB.
