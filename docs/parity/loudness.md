# Loudness normalisation

CapCut's "Normalize loudness" switch stores a `loudnesses` material on the clip:

```json
{"enable": true, "target_loudness": -23.0, "time_range": {...},
 "loudness_param": {"avg_loudness": -36.23, "peak_loudness": -18.25}}
```

In the local drafts, 31 clips have it switched on, all with target −23 LUFS. OpenRip used to ignore it, so those clips played at their raw level: about 13 dB too quiet in the example above.

**What the measured value is.** `avg_loudness` is EBU R128 integrated loudness over the clip's source range. FFmpeg's `ebur128` filter gives −36.2 LUFS for the example clip's range, against CapCut's −36.23.

**What OpenRip does.** The importer maps the material to `Loudness`. The mixer multiplies the clip by the gain from the measured loudness to the target. When that gain would push the recorded sample peak above full scale, it is held back so the peak stays at 0 dBFS. For the example, the gain is +13.2 dB and the peak lands at −5 dBFS, so the hold doesn't apply.

**Not measured yet.** Whether CapCut limits the peak at all, and where:
- the hold only matters for clips whose peak is within the gain of full scale;
- a calibration export of such a clip, normalised, would settle it.
