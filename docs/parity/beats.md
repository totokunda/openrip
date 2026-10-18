# Beat markers

CapCut marks beats on music clips: by hand ("Mark beats", Add beat at the playhead) and automatically ("Auto beat", every beat or only bar starts: Beat 2 and Beat 1). Clips and the playhead snap to them. OpenRip keeps both kinds, imports CapCut's, and finds beats itself with classic signal processing.

## CapCut's beats

A music clip's `beats` material (in `extra_material_refs`):

```json
{"type": "beats", "enable_ai_beats": false, "gear": 404, "mode": 404, "user_beats": [],
 "user_delete_ai_beats": null,
 "ai_beats": {"beats_path": ".../Cache/music/<hash>.beat", "melody_percents": [0.6], ...}}
```

- `user_beats`: the hand-marked beats, `int64` µs (CapCut's schema). No local draft has any; OpenRip reads them as µs of the clip's media.
- `enable_ai_beats`: Auto beat on. `gear` picks the density; the schema's default is 0 and the drafts have 404 (never set). OpenRip takes 1 as Beat 2 (every beat) and anything else as Beat 1 (bar starts).
- `ai_beats.beats_path`: a JSON file CapCut downloads with a library song: parallel `time` (ms), `value` (the beat's place in its bar, 1–4) and `energy` arrays. It's CapCut's (server-side) analysis of the whole song.
- `user_delete_ai_beats`: automatic beats taken off by hand. Always null locally; its shape isn't known, so it isn't mapped.

In the local drafts: 192 beats materials, none with Auto beat on or a hand-marked beat; 31 have their beats file on this Mac. The importer reads the file into the material's `detected` beats whatever the switch says, so turning Auto beat on in OpenRip shows CapCut's own beats for that song.

## OpenRip's detector

For the app's own clips, and drafts' songs without a beats file (`engine/crates/audio/src/beats.rs`):

1. **Onsets**: a spectral flux at 22.05 kHz, 1024-sample frames every 256 (11.6 ms), 24 log-spaced bands from 40 Hz to 10 kHz, log-compressed; each frame's rise over the last, summed. The flux less its local mean (±0.25 s), normalised.
2. **Tempo**: the flux's autocorrelation (smoothed by a 1.5-frame Gaussian so a period between frames still lines up) over 40–220 BPM, weighted by a log-Gaussian around 120 BPM (one octave either side), refined by a parabola.
3. **Beats**: Ellis's dynamic programming (2007), tightness 100, from the best-scoring frame in the last period back to the start.
4. **Bars**: in fours, the phase whose beats carry the most bass onsets (below 200 Hz) starts them.
5. Beats at either end where the sound is near its quietest are dropped.

A frame's flux rises as soon as a sound enters its window's tail (the log makes even a little count), so a beat is placed 0.8 of a frame into it: clicks land within a frame of their start.

The engine keeps each file's beats on disk with the thumbnails and waveforms (`beats-v1.json`, keyed by path, size and modification time).

## Checks

- **Synthetic clicks** at 90, 120 and 150 BPM: the tempo within 1.5 BPM, every click found within 25 ms, no extra beats, none in the leading silence, and the loud clicks as bar starts (unit tests).
- **Against CapCut's beats** (`openrip-dev beat-scan`): the ten songs with beats files and readable media. F is the F-measure of matches within 70 ms; CapCut's tempo is from its median beat interval (it leaves out a beat here and there, which counts against our precision).

| Song | CapCut | Ours | F | Offset | Bar starts agreed |
|---|---|---|---|---|---|
| 1 | 87.0 BPM | 87.1 | 0.79 | +8 ms | 64% |
| 2 | 139.5 | 143.9 | 0.77 | +1 ms | 53% |
| 3 | 65.2 | 120.3 | 0.31 | +14 ms | 67% |
| 4 | 115.4 | 115.0 | 0.66 | +18 ms | 23% |
| 5 | 139.5 | 140.0 | **0.99** | −4 ms | 100% |
| 6 | 107.1 | 113.2 | 0.67 | +21 ms | 25% |
| 7 | 89.6 | 90.0 | **0.99** | −4 ms | 100% |
| 8 | 88.2 | 88.6 | 0.71 | +16 ms | 31% |
| 9 | 75.0 | 149.5 | 0.41 | +4 ms | 38% |
| 10 | 103.4 | 113.6 | 0.48 | +3 ms | 27% |

Mean F 0.68. On steady songs the two agree almost exactly (two at 0.99, bar starts included). The misses:
- **Octaves.** Two songs where CapCut counts half time and we count the beat (3 and 9; our beats include all of CapCut's there).
- **Changing tempo.** Two songs whose beat drifts (CapCut's intervals spread from 0.46 to 0.58 s on song 10); the detector holds one period.
- **Bars.** Picking the bar's first beat by bass onsets agrees on steady songs only.

A marker 20 ms early or late is under a frame at 30 fps.

## In the app

`lib/beats.ts` keeps a clip's markers in seconds of its media (`beats: {manual, auto, everyBeat, detected}` on video and audio clips), places them on the timeline through the clip's trim, speed, curve and direction, and gives them to snapping (`snapPoints`' `beats`, from `beatSnapPoints`). Automatic beats come from the engine (`engineBeats`, once per file and session), or a draft's own. See docs/plan/app-engine-integration.md, "Audio tools".

## Open

- `user_delete_ai_beats`'s shape, and whether `gear` 0 is Beat 1.
- Tempo changes within a song; the half-time/double-time choice CapCut makes.
- Downbeats from harmony or a learned meter, not bass alone.
