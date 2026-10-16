# Voice filters

CapCut's "Voice filters" are SAMI `music_dsp_effect`s: each bundle holds `mdsp_preset.json`, a graph of named processors, and `extra.json`, its sliders. A clip's `audio_effects` material names the bundle and gives the slider values (`audio_adjust_params`). OpenRip rebuilds the graph from the same processors (`engine/crates/audio/src/fx.rs`). A filter works on the clip's sound after its speed change and before its volume. The whole mix is limited at full scale.

## The local drafts' filters

| Filter | Uses (with export) | Graph | OpenRip |
|---|---|---|---|
| Deep | 4 (4) | sliders → PitchAndFormantShift → Limiter | ✅ |
| Low | 1 (1) | the same, other presets; at the clip's sliders (0, 0) it shifts nothing | ✅ |
| Voice Crisper | 1 (1) | Equaliser, wet/dry | ✅ |
| Demonized | 1 (1) | Chorus → Tremolo → Limiter (its pitch shifter and reverb are bypassed), wet/dry | ✅ |
| Deep 2 | 1 (0) | Equaliser → Compressor → StudioReverb → Limiter, wet/dry | without the reverb |

## Parameters

- **Sliders.** `ParameterChangeTransform` nodes map each slider (by `parameterIndex` in `extra.json`) through a piecewise-linear curve onto a normalised parameter of the node they feed.
- **Semitone shifts** span ±24: Deep's slider defaults then give exactly the preset's stored −4 (pitch) and −6 (formant). The fine tune adds in semitones: the export's pitch falls 4.75–4.87 semitones for −4 − 0.8.
- **Wet/dry gains** are −70 dB (off) at 0 and 0 dB at 0.4444, where every local clip has them (strength 1: all wet). Values between are taken as linear in dB (only those two points are known).

## Processors

- **PitchAndFormantShift**: a phase vocoder with peak shifting (Laroche & Dolson): each partial's whole spectral lobe moves to its new frequency with a running phase rotation, so partials keep their level (a tone stays within 0.7 dB at −4.8 and +3.9 semitones; resampling the spectrum instead lost 6.4 dB). Its amplitude follows each frame's cepstrally smoothed envelope moved by the formant ratio. 2048-sample frames at a quarter hop; the mixer runs it 2048 samples ahead, so it lines up (within 1 ms of CapCut).
- **Equaliser**: JUCE's (RBJ) bell, shelf and pass filters, up to eight.
- **Limiter**: input gain, a ceiling, instant attack, exponential release.
- **Compressor**: feed-forward with a soft knee; auto makeup gain makes up half the full-scale reduction (unchecked: no export).
- **Chorus**: a delay of `Delay` + `Depth` ms swept at `Rate`, the right channel offset by the stereo phase, feedback, mixed by `Wetness`.
- **Tremolo**: a steady `Rate Hz` swing of ±`Depth`/2 around unity, from `Phase`. On Demonized's export it matches CapCut's 14 Hz wobble (2.47× its surroundings vs CapCut's 2.41×) and level (+0.6 dB); dipping by `Depth` below unity instead comes out 2.2 dB quiet.
- **Gain, GainAndPan, Mixer**: as named.

## The mix's limiter

CapCut's exports stay within full scale. Where a clip at 458% volume plays over the same voice, OpenRip's mix reached twice full scale and 3.3 dB louder than CapCut's export, which peaks at 1.00. A limiter on the whole mix (instant attack, 350 ms release; 300–500 ms fit) brings that second to +0.4…+0.9 dB and changes nothing where the mix stays under full scale.

## Checks against the exports

Mixes of the effect windows against CapCut's exports. "Distance" is the per-frame, per-band (20 log bands, 150–8000 Hz) level difference with the overall level removed.

| Window | Without the filter | With it |
|---|---|---|
| Deep, three uses | 5.3–5.8 dB | 1.6–2.05 dB, level +0.4…+0.6 dB |
| Deep's formant shift tried at −5 / −6 / −7 / −8 semitones | | 1.72–2.14 / 1.62–2.07 / 1.91–2.30 / 2.44–2.97 dB |
| Low | 0.61 dB | 0.57 dB (no shift at its sliders) |
| Voice Crisper, average level per band | off by +2.5 … +6.1 dB above 1 kHz | within ±0.2 dB everywhere |
| Demonized (with a Deep clip over it) | 7.3 dB | 6.5 dB, level +0.9 dB; band levels within 1.7 dB; wobbles at 14 Hz like CapCut |

For scale: unprocessed stretches of the same clips score 0.9–1.4 dB (the export's AAC coding).

## Still open

- Demonized's window (two copies of the voice, one sped up 2.3× with Deep) is still 6.5 dB off, more than its band levels suggest.
- StudioReverb (Deep 2) isn't drawn; the tremolo's `Mod_Rate` isn't known.
- Wet/dry strengths between 0 and 1.
