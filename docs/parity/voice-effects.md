# Voice filters

CapCut's "Voice filters" are SAMI `music_dsp_effect`s: each bundle holds `mdsp_preset.json`, a graph of named processors, and `extra.json`, its sliders. A clip's `audio_effects` material names the bundle and gives the slider values (`audio_adjust_params`). OpenRip rebuilds the graph from the same processors (`engine/crates/audio/src/fx.rs`). A filter works on the clip's sound after its speed change and before its volume.

## The local drafts' filters

| Filter | Uses (with export) | Graph | OpenRip |
|---|---|---|---|
| Deep | 4 (4) | sliders → PitchAndFormantShift → Limiter | ✅ |
| Low | 1 (1) | the same, other presets; at the clip's sliders (0, 0) it shifts nothing | ✅ |
| Voice Crisper | 1 (1) | Equaliser, wet/dry | ✅ |
| Demonized | 1 (1) | Chorus → Tremolo → Limiter (its pitch shifter and reverb are bypassed), wet/dry | ✅, tremolo provisional |
| Deep 2 | 1 (0) | Equaliser → Compressor → StudioReverb → Limiter, wet/dry | without the reverb |

## Parameters

- **Sliders.** `ParameterChangeTransform` nodes map each slider (by `parameterIndex` in `extra.json`) through a piecewise-linear curve onto a normalised parameter of the node they feed.
- **Semitone shifts** span ±24: Deep's slider defaults then give exactly the preset's stored −4 (pitch) and −6 (formant). The fine tune adds in semitones: the export's pitch falls 4.75–4.87 semitones for −4 − 0.8.
- **Wet/dry gains** are −70 dB (off) at 0 and 0 dB at 0.4444, where every local clip has them (strength 1: all wet). Values between are taken as linear in dB (only those two points are known).

## Processors

- **PitchAndFormantShift**: a phase vocoder moves the harmonics by the pitch ratio and each frame's cepstrally smoothed envelope by the formant ratio. 2048-sample frames at a quarter hop; the mixer runs it 2048 samples ahead, so it lines up.
- **Equaliser**: JUCE's (RBJ) bell, shelf and pass filters, up to eight.
- **Limiter**: input gain, a ceiling, instant attack, exponential release.
- **Compressor**: feed-forward with a soft knee; auto makeup gain makes up half the full-scale reduction (unchecked: no export).
- **Chorus**: a delay of `Delay` + `Depth` ms swept at `Rate`, the right channel offset by the stereo phase, feedback, mixed by `Wetness`.
- **Tremolo**: a steady `Rate Hz` dip of `Depth` (capped at 1).
- **Gain, GainAndPan, Mixer**: as named.

## Checks against the exports

Mixes of the effect windows against CapCut's exports. "Distance" is the per-frame, per-band (20 log bands, 150–8000 Hz) level difference with the overall level removed.

| Window | Without the filter | With it |
|---|---|---|
| Deep, three uses | 5.3–5.8 dB | 2.1–2.4 dB |
| Deep's formant shift tried at −9 / −7.5 / −6 / −4.8 / −3 / 0 semitones | | 3.5 / 2.7 / 2.1 / 2.1 / 3.0 / 4.4 dB |
| Low | 0.61 dB | 0.58 dB (no shift at its sliders) |
| Voice Crisper, average level per band | off by +2.5 … +6.1 dB above 1 kHz | within ±0.2 dB everywhere |
| Demonized (with a Deep clip over it), average level per band | off by up to 7.3 dB | within 1.7 dB; wobbles at 14 Hz like CapCut |

## Still open

- Deep comes out 1–2 dB quieter than CapCut's.
- StudioReverb (Deep 2) isn't drawn; the tremolo's `Mod_Rate` isn't known.
- Wet/dry strengths between 0 and 1.
