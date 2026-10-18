# Voice filters

CapCut's "Voice filters" are SAMI `music_dsp_effect`s: each bundle holds `mdsp_preset.json`, a graph of named processors, and `extra.json`, its sliders. A clip's `audio_effects` material names the bundle and gives the slider values (`audio_adjust_params`). OpenRip rebuilds the graph from the same processors (`engine/crates/audio/src/fx.rs`). A filter works on the clip's sound after its speed change and before its volume. The whole mix is limited at full scale.

The app's own clips use OpenRip's own effects instead (see below), which need no CapCut bundle.

## The local drafts' filters

| Filter | Uses (with export) | Graph | OpenRip |
|---|---|---|---|
| Deep | 4 (4) | sliders → PitchAndFormantShift → Limiter | ✅ |
| Low | 1 (1) | the same, other presets; at the clip's sliders (0, 0) it shifts nothing | ✅ |
| Voice Crisper | 1 (1) | Equaliser, wet/dry | ✅ |
| Demonized | 1 (1) | Chorus → Tremolo → Limiter (its pitch shifter and reverb are bypassed), wet/dry | ✅ |
| Deep 2 | 1 (0) | Equaliser → Compressor → StudioReverb → Limiter, wet/dry | ✅ (the reverb unchecked: no export, and its clip is a photo) |

## Parameters

- **Sliders.** `ParameterChangeTransform` nodes map each slider (by `parameterIndex` in `extra.json`) through a piecewise-linear curve onto a normalised parameter of the node they feed.
- **Semitone shifts** span ±24: Deep's slider defaults then give exactly the preset's stored −4 (pitch) and −6 (formant). The fine tune adds in semitones: the export's pitch falls 4.75–4.87 semitones for −4 − 0.8.
- **Wet/dry gains** are −70 dB (off) at 0 and 0 dB at 0.4444, where every local clip has them (strength 1: all wet). Values between are taken as linear in dB (only those two points are known).

## Processors

- **PitchAndFormantShift**: a phase vocoder with peak shifting (Laroche & Dolson): each partial's whole spectral lobe moves to its new frequency with a running phase rotation, so partials keep their level (a tone stays within 0.7 dB at −4.8 and +3.9 semitones; resampling the spectrum instead lost 6.4 dB). Its amplitude follows each frame's cepstrally smoothed envelope moved by the formant ratio. 2048-sample frames at a quarter hop; the mixer runs it 2048 samples ahead, so it lines up (within 1 ms of CapCut).
- **TimeDomainPitchShifter**: the same phase vocoder with the formants moving with the pitch (a time-domain shifter moves both). No local draft uses it (Helium, Vinnie and Deep&Clear do).
- **Equaliser**: JUCE's (RBJ) bell, shelf and pass filters, up to eight. **Filter**: one of them (Bass Boost's).
- **Limiter**: input gain, a ceiling, instant attack, exponential release.
- **Compressor**: feed-forward with a soft knee; auto makeup gain makes up half the full-scale reduction (unchecked: no export).
- **Chorus**: a delay of `Delay` + `Depth` ms swept at `Rate`, the right channel offset by the stereo phase, feedback, mixed by `Wetness`.
- **Tremolo**: a steady `Rate Hz` swing of ±`Depth`/2 around unity, from `Phase`. On Demonized's export it matches CapCut's 14 Hz wobble (2.47× its surroundings vs CapCut's 2.41×) and level (+0.6 dB); dipping by `Depth` below unity instead comes out 2.2 dB quiet.
- **StudioReverb** (Deep 2, Super Reverb, Metallic Hell): a feedback delay network (`engine/crates/audio/src/reverb.rs`). Eight lines (31.7–73.1 ms for a hall, scaled by the mode: Room 0.5, Plate 0.75) feed back through an orthogonal Hadamard matrix. Each line loses, per pass, what makes its band die in that band's RT60 (`Low RT60` below `Crossover`, `Hi RT60` above `HF Damping`, `Mid RT60` between; complementary one-pole splits). The input passes four all-passes and a pre-delay per side (`Pre Delay 1`, `2`). The tail's energy is made to match the input's, so `Wet Gain` (dB) alone sets its level against `Wet Mix`; `Wet Stereo Width` narrows it. Deep 2's: a 2 s hall, 3 s in the lows and 1 s in the highs, 15 ms pre-delay, width 0.2, +2.8 dB. The tests check a flat 1.5 s RT60 falls 40 dB/s (±6), damped highs die faster, and the tail keeps the input's energy at 0.5 and 3 s.
- **Reverb** (Mic Echo, Phantom Echo; bypassed in Demonized): the same network with one `Decay Time`, `Damp` shortening the highs' (to 1 − 0.8·Damp of it), a pre-delay, width, mix and gain. Its slow modulation of the tail (`Mod Depth`, `Mod Rate`) isn't drawn.
- **Echo** (Phantom Echo): two taps, each a delay (unsynced; synced delays take it too), feedback, gain and constant-power pan, over the dry sound unless bypassed, the echoes through an optional high- and low-pass.
- **Gain, GainAndPan, Mixer**: as named.

## The mix's limiter

CapCut's exports stay within full scale. Where a clip at 458% volume plays over the same voice, OpenRip's mix reached twice full scale and 3.3 dB louder than CapCut's export, which peaks at 1.00. A limiter on the whole mix (instant attack, 350 ms release; 300–500 ms fit) brings that second to +0.4…+0.9 dB and changes nothing where the mix stays under full scale.

## Checks against the exports

Mixes of the effect windows against CapCut's exports. "Distance" is the per-frame, per-band (20 log bands, 150–8000 Hz) level difference with the overall level removed (`openrip-dev audio-parity` reports it).

| Window | Without the filter | With it |
|---|---|---|
| Deep, three uses | 5.3–5.8 dB | 1.6–2.05 dB, level +0.4…+0.6 dB |
| Deep's formant shift tried at −5 / −6 / −7 / −8 semitones | | 1.72–2.14 / 1.62–2.07 / 1.91–2.30 / 2.44–2.97 dB |
| Low | 0.61 dB | 0.57 dB (no shift at its sliders) |
| Voice Crisper, average level per band | off by +2.5 … +6.1 dB above 1 kHz | within ±0.2 dB everywhere |
| Demonized (with a Deep clip over it) | 7.3 dB | 6.5 dB, level +0.9 dB; band levels within 1.7 dB; wobbles at 14 Hz like CapCut |

For scale: unprocessed stretches of the same clips score 0.9–1.4 dB (the export's AAC coding).

## OpenRip's own effects

The app's clips take OpenRip's effects (`engine/crates/audio/src/voice.rs`), classic DSP that behaves like CapCut's common voice filters with nothing of CapCut's. A clip's `audioEffects` play one after another; each is a kind with its parameters, and every kind has a strength (0–100, CapCut's slider) that mixes the clip's own sound back in, delayed by the effect's latency so the two line up. Each ends in a limiter at −0.3 dB, as CapCut's presets do.

| Kind | What it is | Parameters (defaults) |
|---|---|---|
| `pitch` | the phase vocoder above: pitch and formants (the voice's size) apart | semitones (−4), formant (follows the pitch) |
| `robot` | the phase vocoder with its phases dropped, frames one buzz period apart: the words on one monotone pitch | pitch (120 Hz) |
| `echo` | repeats, each fainter and duller (a low-pass in the loop) | delay (250 ms), feedback (40%), mix (40%), damping (5 kHz) |
| `reverb` | the feedback delay network above, the highs damped | decay (1.8 s), size (60%), damping (50%), predelay (20 ms), mix (30%) |
| `chorus` | CapCut's chorus processor; at full mix and no feedback a vibrato | rate (1.5 Hz), depth (3 ms), delay (12 ms), feedback (0), mix (50%) |
| `tremolo` | CapCut's tremolo, its peaks kept at the clip's level | rate (6 Hz), depth (60%) |
| `distortion` | tanh soft clipping, half the drive taken back, a tone low-pass | drive (18 dB), tone (6 kHz) |
| `bitcrush` | samples held and rounded to fewer bits | bits (6), downsample (6) |
| `lowpass`, `highpass` | RBJ filters | frequency (1.2 kHz / 600 Hz), q (0.71) |
| `eq` | shelves at 120 Hz and 6 kHz, a bell at 1.5 kHz | low, mid, high (0 dB) |
| `telephone` | a little overdrive, then a phone line's 300–3400 Hz band | drive (8 dB) |
| `megaphone` | a 2 kHz honk into hard overdrive, then a narrow band | drive (20 dB) |
| `gain` | a level | db (0) |

The presets the app lists (`lib/audio-effects.ts`): Deep (−4/−6 semitones, as CapCut's sliders give), Low, High, Chipmunk, Helium, Monster, Robot, Alien, Tremble, Vibrato, Chorus, Echo, Mic Echo, Small Room, Hall, Cathedral, Telephone, Megaphone, Lo-Fi, Distorted, Muffled, Thin, Bass Boost, Voice Crisper, Fuller Voice. A renderer test checks every preset names a kind the engine has with parameters it knows, in range.

Tested on tones and impulses (`voice.rs`, `tests/tools.rs`): a tone moved by the pitch's ratio, the robot's output on its buzz's harmonics, an echo's repeats 100 ms apart at half the level and nothing between, a reverb's tail, filters and bands passing and stopping what they should (a phone line's overdrive staying in its band), distortion and bitcrush adding harmonics, the tremolo's swing and the vibrato's steady level, strength 0 giving back the clip exactly, effects in a chain, and a pitch shift lining up with its clip. Through the app (the harness's `audio` step): Telephone takes the lows and highs off an exported clip, and strength 0 exports the clip unchanged.

## The rest of the clip's sound

- **Channel fill** (CapCut's "Fill channel"): `sound_channel_mappings` with its switch on (`is_config_open`) and `audio_channel_mapping` 1 plays the left channel on both sides ("Fill right with left"), 2 the right. Read from CapCut's engine (`TEAudioChannelMapping::process`: 1 copies channel 0 over 1, 2 channel 1 over 0, in both its planar and interleaved paths; a mono source is left alone). It applies after the speed change, before the filters. No local draft has it on (1,101 materials, all 0). OpenRip adds "mono" (both channels' mean). CapCut has no balance or pan.
- **Keyframed volume** is followed at each sample's own time (the mixer used to interpolate across each block, so a ramp's shape depended on the block size: 4096 samples in export, 1024 in playback). A test mixes the same ramp in blocks of 4096, 1024 and 333 samples and gets the same samples, each the curve's value at its time. No local draft keys volume. A clip without volume keys mixes exactly as before.
- **Extracted sound.** CapCut silences a video whose sound was extracted to an audio clip (an `audios` material of type `video_original_sound` names it by `video_id`); OpenRip played both. With that, the draft with extracted clips and an export mixes at +0.02 dB of it (from +0.22) and correlation 0.919 (from 0.896); the second where the clip and its extracted copy played together went from +3.5 dB to +0.0 dB. 25 audible video clips in 13 drafts have their sound extracted; 4 of those drafts have their media here, and their mixes change; no other draft's does. The window where the extracted clip has CapCut's Enhance voice and Isolate voice on stays about 1 dB off: those are AI results CapCut didn't leave on this Mac.

## Before and after (against the 8992db2f build)

- Every draft mixed in full by both builds (`openrip-dev mix`, 68 drafts): 64 byte-identical; the other 4 are the drafts with extracted sound (above). Deep 2's reverb changes no mix here: its clip is a photo.
- `app-roundtrip`: 138.1 dB worst, as before; with `--audio` the converted projects mix as the drafts do, to float rounding (6·10⁻⁸: the app lists tracks in another order, so the mixer sums them in another).
- `preview-scan` and `cover-parity`: the same counts and PSNRs.

## Still open

- Demonized's window (two copies of the voice, one sped up 2.3× with Deep) is still 6.5 dB off, more than its band levels suggest. Its draft's media and export are no longer on this Mac (moved off), so it can't be checked again here.
- StudioReverb against an export (Deep 2's only use is on a photo), the tremolo's `Mod_Rate`, the Reverb's modulation.
- Wet/dry strengths between 0 and 1.
