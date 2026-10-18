// Voice effects on a video or audio clip (lib/types.ts `ClipAudio.audioEffects`), for the Audio
// tab's Voice changer: OpenRip's own presets as data (each one of the engine's effect kinds with
// its parameters), the kinds' parameters with their ranges for sliders, and pure helpers
// returning patches for `updateClip`. The presets are classic DSP that behaves like CapCut's
// common voice filters, with no CapCut bundle needed; the engine plays a clip's effects one after
// another, after its speed change and before its volume (engine/crates/audio/src/voice.rs,
// docs/parity/voice-effects.md). A clip converted from a CapCut draft lists its own voice filter
// as a `{type: "draft"}` entry, which plays CapCut's bundle and has no parameters here.
import type { AnyClipProps, AudioEffect, AudioEffectKind } from "./types";

/** One parameter of an effect kind: its key, label, range, step, unit and the engine's default. */
export type AudioEffectParam = { key: string; name: string; min: number; max: number; step: number; default: number; unit?: string };

/** Every kind's strength: the processed sound against the clip's own (CapCut's Strength). */
const STRENGTH: AudioEffectParam = { key: "strength", name: "Strength", min: 0, max: 100, step: 1, default: 100, unit: "%" };

/** The engine's effect kinds, their names and parameters (defaults as the engine has them). */
export const AUDIO_EFFECT_KINDS: Record<AudioEffectKind, { name: string; params: AudioEffectParam[] }> = {
  pitch: {
    name: "Pitch",
    params: [
      { key: "semitones", name: "Pitch", min: -12, max: 12, step: 0.1, default: -4, unit: "st" },
      // Missing, the formants follow the pitch.
      { key: "formant", name: "Timbre", min: -12, max: 12, step: 0.1, default: -4, unit: "st" },
    ],
  },
  robot: { name: "Robot", params: [{ key: "pitch", name: "Pitch", min: 30, max: 400, step: 1, default: 120, unit: "Hz" }] },
  echo: {
    name: "Echo",
    params: [
      { key: "delay", name: "Delay", min: 20, max: 1000, step: 1, default: 250, unit: "ms" },
      { key: "feedback", name: "Repeats", min: 0, max: 90, step: 1, default: 40, unit: "%" },
      { key: "mix", name: "Mix", min: 0, max: 100, step: 1, default: 40, unit: "%" },
      { key: "damping", name: "Tone", min: 500, max: 16000, step: 100, default: 5000, unit: "Hz" },
    ],
  },
  reverb: {
    name: "Reverb",
    params: [
      { key: "decay", name: "Decay", min: 0.2, max: 10, step: 0.1, default: 1.8, unit: "s" },
      { key: "size", name: "Size", min: 0, max: 100, step: 1, default: 60, unit: "%" },
      { key: "damping", name: "Damping", min: 0, max: 100, step: 1, default: 50, unit: "%" },
      { key: "predelay", name: "Pre-delay", min: 0, max: 200, step: 1, default: 20, unit: "ms" },
      { key: "mix", name: "Mix", min: 0, max: 100, step: 1, default: 30, unit: "%" },
    ],
  },
  chorus: {
    name: "Chorus",
    params: [
      { key: "rate", name: "Rate", min: 0.1, max: 10, step: 0.1, default: 1.5, unit: "Hz" },
      { key: "depth", name: "Depth", min: 0, max: 10, step: 0.1, default: 3, unit: "ms" },
      { key: "delay", name: "Delay", min: 1, max: 40, step: 0.5, default: 12, unit: "ms" },
      { key: "feedback", name: "Feedback", min: 0, max: 90, step: 1, default: 0, unit: "%" },
      { key: "mix", name: "Mix", min: 0, max: 100, step: 1, default: 50, unit: "%" },
    ],
  },
  tremolo: {
    name: "Tremolo",
    params: [
      { key: "rate", name: "Rate", min: 0.5, max: 30, step: 0.1, default: 6, unit: "Hz" },
      { key: "depth", name: "Depth", min: 0, max: 100, step: 1, default: 60, unit: "%" },
    ],
  },
  distortion: {
    name: "Distortion",
    params: [
      { key: "drive", name: "Drive", min: 0, max: 40, step: 0.5, default: 18, unit: "dB" },
      { key: "tone", name: "Tone", min: 1000, max: 16000, step: 100, default: 6000, unit: "Hz" },
    ],
  },
  bitcrush: {
    name: "Bitcrush",
    params: [
      { key: "bits", name: "Bits", min: 2, max: 16, step: 1, default: 6 },
      { key: "downsample", name: "Downsample", min: 1, max: 32, step: 1, default: 6, unit: "×" },
    ],
  },
  lowpass: {
    name: "Low-pass",
    params: [
      { key: "frequency", name: "Cutoff", min: 100, max: 16000, step: 10, default: 1200, unit: "Hz" },
      { key: "q", name: "Resonance", min: 0.3, max: 8, step: 0.01, default: 0.71 },
    ],
  },
  highpass: {
    name: "High-pass",
    params: [
      { key: "frequency", name: "Cutoff", min: 20, max: 8000, step: 10, default: 600, unit: "Hz" },
      { key: "q", name: "Resonance", min: 0.3, max: 8, step: 0.01, default: 0.71 },
    ],
  },
  eq: {
    name: "Equalizer",
    params: [
      { key: "low", name: "Low", min: -15, max: 15, step: 0.5, default: 0, unit: "dB" },
      { key: "mid", name: "Mid", min: -15, max: 15, step: 0.5, default: 0, unit: "dB" },
      { key: "high", name: "High", min: -15, max: 15, step: 0.5, default: 0, unit: "dB" },
    ],
  },
  telephone: { name: "Telephone", params: [{ key: "drive", name: "Drive", min: 0, max: 30, step: 0.5, default: 8, unit: "dB" }] },
  megaphone: { name: "Megaphone", params: [{ key: "drive", name: "Drive", min: 0, max: 40, step: 0.5, default: 20, unit: "dB" }] },
  gain: { name: "Gain", params: [{ key: "db", name: "Gain", min: -24, max: 12, step: 0.5, default: 0, unit: "dB" }] },
};

/** A kind's parameters, Strength last. */
export const paramsOf = (kind: AudioEffectKind | string): AudioEffectParam[] => [...(AUDIO_EFFECT_KINDS[kind as AudioEffectKind]?.params ?? []), STRENGTH];

/** The Voice changer's groups, in its order. */
export type AudioEffectGroup = "voice" | "character" | "space" | "radio" | "tone";
export const AUDIO_EFFECT_GROUPS: { id: AudioEffectGroup; name: string }[] = [
  { id: "voice", name: "Voice" },
  { id: "character", name: "Character" },
  { id: "space", name: "Space" },
  { id: "radio", name: "Radio" },
  { id: "tone", name: "Tone" },
];

/** A preset: a name in the Voice changer, its group, and the effect it applies. */
export type AudioEffectPreset = { id: string; name: string; group: AudioEffectGroup; effect: AudioEffect };

const preset = (id: string, name: string, group: AudioEffectGroup, type: AudioEffectKind, params: Record<string, number> = {}): AudioEffectPreset => ({
  id,
  name,
  group,
  effect: { type, name, params },
});

/**
 * OpenRip's presets. Several stand in for CapCut voice filters of the same name, made the
 * way CapCut's bundles make them: Deep and Low lower the pitch and the voice's size (Deep −4
 * and −6 semitones, its sliders' defaults), High and Chipmunk raise them, Bass Boost and
 * Voice Crisper are shelving EQs, Mic Echo a short bright room.
 */
export const AUDIO_EFFECT_PRESETS: AudioEffectPreset[] = [
  preset("deep", "Deep", "voice", "pitch", { semitones: -4, formant: -6 }),
  preset("low", "Low", "voice", "pitch", { semitones: -2.5, formant: -3 }),
  preset("high", "High", "voice", "pitch", { semitones: 4, formant: 2 }),
  preset("chipmunk", "Chipmunk", "voice", "pitch", { semitones: 8, formant: 6 }),
  preset("helium", "Helium", "voice", "pitch", { semitones: 5, formant: 5 }),
  preset("monster", "Monster", "character", "pitch", { semitones: -8, formant: -5 }),
  preset("robot", "Robot", "character", "robot", { pitch: 110 }),
  preset("alien", "Alien", "character", "chorus", { rate: 6, depth: 4, delay: 3, feedback: 60, mix: 70 }),
  preset("tremble", "Tremble", "character", "tremolo", { rate: 8, depth: 70 }),
  preset("vibrato", "Vibrato", "character", "chorus", { rate: 5.5, depth: 1.5, delay: 2, feedback: 0, mix: 100 }),
  preset("chorus", "Chorus", "character", "chorus"),
  preset("echo", "Echo", "space", "echo"),
  preset("mic-echo", "Mic Echo", "space", "reverb", { decay: 0.9, size: 25, damping: 30, predelay: 5, mix: 25 }),
  preset("small-room", "Small Room", "space", "reverb", { decay: 0.6, size: 20, damping: 60, predelay: 5, mix: 25 }),
  preset("hall", "Hall", "space", "reverb", { decay: 2.4, size: 80, damping: 50, predelay: 25, mix: 35 }),
  preset("cathedral", "Cathedral", "space", "reverb", { decay: 6, size: 100, damping: 40, predelay: 50, mix: 45 }),
  preset("telephone", "Telephone", "radio", "telephone"),
  preset("megaphone", "Megaphone", "radio", "megaphone"),
  preset("lo-fi", "Lo-Fi", "radio", "bitcrush", { bits: 6, downsample: 4 }),
  preset("distorted", "Distorted", "radio", "distortion", { drive: 24, tone: 5000 }),
  preset("muffled", "Muffled", "tone", "lowpass", { frequency: 700, q: 0.71 }),
  preset("thin", "Thin", "tone", "highpass", { frequency: 900, q: 0.71 }),
  preset("bass-boost", "Bass Boost", "tone", "eq", { low: 8 }),
  preset("voice-crisper", "Voice Crisper", "tone", "eq", { low: -2, mid: 2, high: 5 }),
  preset("fuller-voice", "Fuller Voice", "tone", "eq", { low: 4, mid: 1.5, high: 1 }),
];

/** A preset by id. */
export const presetById = (id: string): AudioEffectPreset | undefined => AUDIO_EFFECT_PRESETS.find((p) => p.id === id);

/** Clips that have sound to change: videos (their own sound) and audio clips. */
export const hasSound = (clip: AnyClipProps) => clip.type === "video" || clip.type === "audio";

const effectsOf = (clip: AnyClipProps): AudioEffect[] => ((clip as any).audioEffects as AudioEffect[] | undefined) ?? [];

const copy = (e: AudioEffect): AudioEffect => ({ ...e, params: e.params ? { ...e.params } : undefined });

/** A patch setting the clip's voice effects. */
export const setAudioEffects = (clip: AnyClipProps, effects: AudioEffect[]): Partial<AnyClipProps> =>
  hasSound(clip) ? ({ audioEffects: effects.map(copy) } as Partial<AnyClipProps>) : {};

/** CapCut's Voice changer picks one filter: a patch replacing the clip's effects with a preset's. */
export const applyPreset = (clip: AnyClipProps, id: string): Partial<AnyClipProps> => {
  const p = presetById(id);
  return p ? setAudioEffects(clip, [p.effect]) : {};
};

/** A patch adding an effect after the clip's others (OpenRip's stacking). */
export const addAudioEffect = (clip: AnyClipProps, effect: AudioEffect): Partial<AnyClipProps> => setAudioEffects(clip, [...effectsOf(clip), effect]);

/** A patch taking off the effect at `index`. */
export const removeAudioEffect = (clip: AnyClipProps, index: number): Partial<AnyClipProps> => setAudioEffects(clip, effectsOf(clip).filter((_, i) => i !== index));

/** A patch taking every effect off (CapCut's "None"). */
export const clearAudioEffects = (clip: AnyClipProps): Partial<AnyClipProps> => setAudioEffects(clip, []);

/** A parameter's value on an effect: its own, else the kind's default. */
export const paramValue = (effect: AudioEffect, key: string): number => {
  const v = effect.params?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const p = paramsOf(effect.type).find((q) => q.key === key);
  // A pitch's timbre follows its pitch until set.
  if (effect.type === "pitch" && key === "formant") return paramValue(effect, "semitones");
  return p?.default ?? 0;
};

/** A patch setting one parameter of the effect at `index`, kept within its range. */
export const setEffectParam = (clip: AnyClipProps, index: number, key: string, value: number): Partial<AnyClipProps> => {
  const list = effectsOf(clip);
  const e = list[index];
  if (!e || e.type === "draft") return {};
  const p = paramsOf(e.type).find((q) => q.key === key);
  if (!p) return {};
  const v = Math.min(p.max, Math.max(p.min, Number(value)));
  const next = list.map((x, i) => (i === index ? { ...x, params: { ...(x.params ?? {}), [key]: v } } : x));
  return setAudioEffects(clip, next);
};

/** CapCut's "Apply to all": the same effects on every clip with sound. `[clipId, patch]` per clip. */
export const applyEffectsToAll = (clips: AnyClipProps[], effects: AudioEffect[]): [string, Partial<AnyClipProps>][] =>
  clips.filter(hasSound).map((c) => [c.clipId, setAudioEffects(c, effects)]);
