# Loudness normalisation

CapCut's "Normalize loudness" switch stores a `loudnesses` material on the clip:

```json
{"enable": true, "target_loudness": -23.0, "time_range": {...},
 "loudness_param": {"avg_loudness": -36.23, "peak_loudness": -18.25}}
```

In the local drafts, 31 clips have it switched on, all with target −23 LUFS. OpenRip used to ignore it, so those clips played at their raw level: about 13 dB too quiet in the example above.

**What the measured value is.** `avg_loudness` is EBU R128 integrated loudness over the clip's source range (`time_range`), `peak_loudness` its sample peak. FFmpeg's `ebur128` filter gives −36.2 LUFS for the example clip's range, against CapCut's −36.23.

**What OpenRip does.** The importer maps the material to `Loudness`. The mixer multiplies the clip by the gain from the measured loudness to the target. When that gain would push the recorded sample peak above full scale, it is held back so the peak stays at 0 dBFS. For the example, the gain is +13.2 dB and the peak lands at −5 dBFS, so the hold doesn't apply.

## OpenRip's meter, for the app's own clips

The app's clips have no CapCut measurement, so the engine measures them itself (`engine/crates/audio/src/loudness.rs`): BS.1770-4's K-weighting (its shelf and high-pass, from their analogue prototypes at any rate), 400 ms blocks every 100 ms, the −70 LUFS absolute gate and the −10 LU relative gate, on the sound the mixer plays (48 kHz stereo; a mono file spread over both channels).

**How CapCut blocks a clip.** Its first block ends 100 ms into the clip and reaches back 300 ms before it, into silence: the first three blocks are partly silent, and on a short clip they pull the reading down. Starting with the first full block instead reads up to 1.3 LU louder on a one-second clip; prepending 400 ms of silence (the same thing) gives CapCut's numbers. Tried on the 24 measured ranges of drafts whose media is here (FFmpeg-decoded, at 44.1 kHz):

| Blocks | Mean difference | Largest |
|---|---|---|
| From the first full block | +0.30 LU | 1.26 |
| Partial last block kept | +0.23 | 1.26 |
| 300 ms of silence either side | −0.11 | 0.91 |
| 400 ms of silence after | +0.07 | 1.16 |
| **400 ms of silence before** | **+0.02** | **0.05** |

The meter does that. `openrip-dev loudness-scan` checks it against every range CapCut measured: 23 of the 24 within 0.05 LU (mean +0.04), the other +0.49 (a 1.4 s clip; the same range decoded by FFmpeg at 44.1 kHz reads CapCut's value, so it's where the decoder starts on that clip). Peaks agree within 0.1 dB (mean +0.02).

Unit tests: a 997 Hz tone at −20 dBFS in both channels reads −20.07 LUFS (BS.1770's −20, less the three blocks reaching back before it), a quiet stretch 30 LU down is gated out, a 20 Hz rumble is weighted down and an 8 kHz tone up 3.3 dB against 1 kHz. A mixer test measures a clip, normalises it, and reads the mix at −23.00.

## In the app

`loudness: {enabled, target, measured, peak, range}` on a video or audio clip (lib/types.ts `ClipLoudness`): `lib/audio.ts`'s `normalizeLoudness` measures the media range the clip plays with the engine (`engineLoudness`) and keeps the result on the clip, as CapCut keeps its `loudness_param`; `loudnessStale` tells when a trim has moved the range. The engine's v1 import turns it into the same `Loudness` material a draft has, so the gain and its hold are the same code. A converted draft clip shows its own measurement and takes the app's in its place when changed.

The harness (`apps/app/scripts/smoke`, step `audio`) normalises a clip through the store and exports it: FFmpeg reads the export's clip at the loudness the gain predicts (−23.70 LUFS for −29.90 + 6.21 dB; the gain is from the whole clip, the reading from 6 s of it).

## Not measured yet

Whether CapCut limits the peak at all, and where:
- the hold only matters for clips whose peak is within the gain of full scale;
- a calibration export of such a clip, normalised, would settle it.
