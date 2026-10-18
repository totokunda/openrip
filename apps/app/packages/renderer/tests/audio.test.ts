// Tests for the Audio tab's library files: src/lib/audio-effects.ts, src/lib/audio.ts and
// src/lib/beats.ts. `node --test tests/` in packages/renderer (Node strips the types itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_EFFECT_KINDS,
  AUDIO_EFFECT_PRESETS,
  addAudioEffect,
  applyEffectsToAll,
  applyPreset,
  clearAudioEffects,
  paramValue,
  paramsOf,
  presetById,
  removeAudioEffect,
  setEffectParam,
} from "../src/lib/audio-effects.ts";
import { CHANNEL_FILLS, LOUDNESS_TARGET, loudnessGain, loudnessOff, loudnessStale, normalizeLoudness, placeVoiceover, playedRange, setChannelFill } from "../src/lib/audio.ts";
import { addBeat, addBeatAtPlayhead, beatFrames, beatSnapPoints, beatsOfFile, clearBeats, forgetBeats, frameOfMediaTime, mediaTimeAt, removeBeat, setAutoBeats, shownBeats } from "../src/lib/beats.ts";
import { snapPoints } from "../src/lib/timeline-edit.ts";
import type { AnyClipProps, AudioClipProps, VideoClipProps } from "../src/lib/types.ts";

const close = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const audio = (over: Partial<AudioClipProps> = {}): AudioClipProps => ({ clipId: "a", timelineId: "t", type: "audio", assetId: "x", startFrame: 30, endFrame: 330, trimStart: 0, trimEnd: 0, speed: 1, ...over });

// The engine's kinds (engine/crates/audio/src/voice.rs, `KINDS`), in its order.
const ENGINE_KINDS = ["pitch", "robot", "echo", "reverb", "chorus", "tremolo", "distortion", "bitcrush", "lowpass", "highpass", "eq", "telephone", "megaphone", "gain"];

test("every preset names a kind the engine has, with parameters it knows, in range", () => {
  assert.deepEqual(Object.keys(AUDIO_EFFECT_KINDS), ENGINE_KINDS);
  const ids = new Set<string>();
  for (const p of AUDIO_EFFECT_PRESETS) {
    assert.ok(!ids.has(p.id), `${p.id} twice`);
    ids.add(p.id);
    assert.ok(ENGINE_KINDS.includes(p.effect.type), p.id);
    const params = paramsOf(p.effect.type);
    for (const [k, v] of Object.entries(p.effect.params ?? {})) {
      const q = params.find((x) => x.key === k);
      assert.ok(q, `${p.id}: no parameter ${k}`);
      assert.ok(v >= q!.min && v <= q!.max, `${p.id}.${k} = ${v} outside ${q!.min}…${q!.max}`);
    }
  }
  // Every kind's defaults sit in their ranges, Strength last.
  for (const kind of ENGINE_KINDS) {
    const params = paramsOf(kind);
    assert.equal(params[params.length - 1].key, "strength");
    for (const q of params) assert.ok(q.default >= q.min && q.default <= q.max, `${kind}.${q.key}`);
  }
  // The voice filters CapCut has by name keep its make: Deep is −4 and −6 semitones.
  assert.deepEqual(presetById("deep")!.effect.params, { semitones: -4, formant: -6 });
});

test("voice effect patches: a preset replaces, effects stack, parameters clamp, other clips are left alone", () => {
  const clip = audio();
  const hall = applyPreset(clip, "hall") as Partial<AudioClipProps>;
  assert.equal(hall.audioEffects!.length, 1);
  assert.equal(hall.audioEffects![0].type, "reverb");
  // Patches don't share the preset's objects.
  hall.audioEffects![0].params!.decay = 99;
  assert.equal(presetById("hall")!.effect.params!.decay, 2.4);
  const withHall = { ...clip, ...applyPreset(clip, "hall") } as AudioClipProps;
  const both = { ...withHall, ...addAudioEffect(withHall, { type: "echo" }) } as AudioClipProps;
  assert.deepEqual(both.audioEffects!.map((e) => e.type), ["reverb", "echo"]);
  const set = setEffectParam(both, 1, "feedback", 400) as Partial<AudioClipProps>;
  assert.equal(set.audioEffects![1].params!.feedback, 90);
  assert.deepEqual(setEffectParam(both, 1, "nonsense", 1), {});
  assert.equal(paramValue({ type: "echo" }, "delay"), 250);
  // A pitch's timbre follows the pitch until it's set.
  assert.equal(paramValue({ type: "pitch", params: { semitones: 3 } }, "formant"), 3);
  assert.deepEqual((removeAudioEffect(both, 0) as Partial<AudioClipProps>).audioEffects!.map((e) => e.type), ["echo"]);
  assert.deepEqual((clearAudioEffects(both) as Partial<AudioClipProps>).audioEffects, []);
  // A draft's own filter has no parameters to set.
  const draft = audio({ audioEffects: [{ type: "draft", id: "fx", name: "Deep" }] });
  assert.deepEqual(setEffectParam(draft, 0, "strength", 50), {});
  // Texts have no sound.
  const text = { clipId: "x", type: "text", startFrame: 0, endFrame: 10 } as AnyClipProps;
  assert.deepEqual(applyPreset(text, "deep"), {});
  assert.deepEqual(applyEffectsToAll([clip, text], [{ type: "robot" }]).map(([id]) => id), ["a"]);
});

test("loudness: the clip's played range is measured and kept; trims make it stale", async () => {
  const fps = 30;
  // 300 frames from trim 60 at 2×: media 4 s … 24 s.
  const clip = audio({ trimStart: 60, speed: 2 });
  assert.deepEqual(playedRange(clip, fps), [4, 20]);
  // Reversed, its trims count from the media's end (30 s here).
  assert.deepEqual(playedRange(audio({ trimStart: 60, speed: 2, reverse: true }), fps, 30), [6, 20]);
  const asked: [string, number, number | null][] = [];
  const patch = (await normalizeLoudness(clip, "/m.wav", fps, async (p, s, d) => {
    asked.push([p, s, d]);
    return { integrated: -30.5, peak: -12 };
  })) as Partial<AudioClipProps>;
  assert.deepEqual(asked, [["/m.wav", 4, 20]]);
  assert.deepEqual(patch.loudness, { enabled: true, target: LOUDNESS_TARGET, measured: -30.5, peak: -12, range: [4, 20] });
  const on = { ...clip, ...patch } as AudioClipProps;
  close(loudnessGain(on), 7.5, 1e-9, "gain");
  // Held back where the peak would pass full scale.
  close(loudnessGain({ ...on, loudness: { ...on.loudness!, peak: -3 } }), 3, 1e-9, "held gain");
  assert.equal(loudnessStale(on, fps), false);
  assert.equal(loudnessStale({ ...on, trimStart: 90 }, fps), true);
  const off = { ...on, ...loudnessOff(on) } as AudioClipProps;
  assert.equal(off.loudness!.enabled, false);
  assert.equal(off.loudness!.measured, -30.5);
  assert.equal(loudnessGain(off), 0);
  // Silence measures nothing and changes nothing.
  const quiet = (await normalizeLoudness(clip, "/m.wav", fps, async () => ({ integrated: null, peak: -200 }))) as Partial<AudioClipProps>;
  assert.equal(loudnessGain({ ...clip, ...quiet } as AudioClipProps), 0);
});

test("channel fill: CapCut's menu and the patch", () => {
  assert.deepEqual(CHANNEL_FILLS.map((c) => c.id), ["none", "left", "right", "mono"]);
  assert.equal(CHANNEL_FILLS[1].name, "Fill right with left");
  assert.deepEqual(setChannelFill(audio(), "right"), { channel: "right" });
  assert.deepEqual(setChannelFill({ clipId: "i", type: "image", startFrame: 0, endFrame: 1 } as AnyClipProps, "left"), {});
});

test("a voiceover becomes an asset and a clip on a new audio track at the playhead", () => {
  const calls: string[] = [];
  let n = 0;
  const store = {
    addAsset: (a: any) => {
      calls.push(`asset ${a.path} ${a.type} ${a.duration}`);
      return { id: "asset1", path: a.path, type: "audio" as const, duration: a.duration };
    },
    addTimeline: (t: any) => calls.push(`track ${t.timelineId} ${t.type}`),
    addClip: (c: AnyClipProps) => calls.push(`clip ${c.clipId} on ${c.timelineId} ${c.startFrame}–${c.endFrame}`),
  };
  const clip = placeVoiceover(store, { path: "/media/Voiceover 1.wav", durationSec: 2.5 }, "file:///media/Voiceover%201.wav", 45.4, 30, () => `id${++n}`);
  assert.deepEqual(calls, ["asset file:///media/Voiceover%201.wav audio 2.5", "track id1 audio", "clip id2 on id1 45–120"]);
  assert.equal(clip.assetId, "asset1");
});

test("beats: marked by hand in media time, automatic ones at their density", () => {
  const clip = audio();
  let c = { ...clip, ...addBeat(clip, 2) } as AudioClipProps;
  c = { ...c, ...addBeat(c, 1) } as AudioClipProps;
  assert.deepEqual(addBeat(c, 1.0004), {}, "the same beat twice");
  assert.deepEqual(c.beats!.manual, [1, 2]);
  const grid = { bpm: 120, beats: [0.5, 1, 1.5, 2, 2.5].map((time, i) => ({ time, downbeat: i % 4 === 0 })) };
  assert.deepEqual(shownBeats(c, grid), [1, 2], "Auto beat off");
  c = { ...c, ...setAutoBeats(c, true) } as AudioClipProps;
  assert.deepEqual(shownBeats(c, grid), [0.5, 1, 2, 2.5], "bar starts (Beat 1)");
  c = { ...c, ...setAutoBeats(c, true, true) } as AudioClipProps;
  assert.deepEqual(shownBeats(c, grid), [0.5, 1, 1.5, 2, 2.5], "every beat (Beat 2)");
  // A draft's own beats show instead of the engine's.
  const draft = { ...c, beats: { ...c.beats, manual: [], detected: [{ time: 0.75, downbeat: true }] } } as AudioClipProps;
  assert.deepEqual(shownBeats(draft, grid), [0.75]);
  assert.deepEqual((removeBeat(c, 1.03) as Partial<AudioClipProps>).beats!.manual, [2]);
  assert.deepEqual(removeBeat(c, 1.5), {});
  const cleared = { ...c, ...clearBeats(c) } as AudioClipProps;
  assert.deepEqual(shownBeats(cleared, grid), []);
});

test("beats sit on the timeline through trims, speed, curves and reverse", () => {
  const fps = 30;
  // From frame 30, media from 2 s (trim 60 frames at 1×).
  const clip = audio({ trimStart: 60, beats: { manual: [1, 3, 5] } });
  assert.deepEqual(beatFrames(clip, fps), [60, 120], "the beat at 1 s is trimmed off");
  // At 2×, media 4 s on: 5 s is 15 frames in.
  const fast = audio({ trimStart: 60, speed: 2, beats: { manual: [5] } });
  close(frameOfMediaTime(fast, 5, fps)!, 45, 1e-9, "2×");
  // Reversed: the media's end (10 s) first.
  const back = audio({ trimStart: 0, endFrame: 330, reverse: true, beats: { manual: [9] } });
  close(frameOfMediaTime(back, 9, fps, 10)!, 60, 1e-9, "reversed");
  // Every case is the inverse of the media time the clip plays.
  const curved = audio({ trimStart: 30, speedCurve: { points: [{ x: 0, y: 1 }, { x: 0.5, y: 3 }, { x: 1, y: 1 }] }, speed: 1.6 });
  for (const c of [clip, fast, back, curved] as AnyClipProps[]) {
    for (const f of [40, 100, 250]) {
      const t = mediaTimeAt(c, f, fps, 10);
      close(frameOfMediaTime(c, t, fps, 10)!, f, 1e-6, `frame ${f} of ${JSON.stringify((c as any).speedCurve ?? (c as any).speed)}`);
    }
  }
  // Marking at the playhead keeps the media time there; off the clip, nothing.
  const marked = addBeatAtPlayhead(fast, 60, fps) as Partial<AudioClipProps>;
  assert.deepEqual(marked.beats!.manual, [5, 6]);
  assert.deepEqual(addBeatAtPlayhead(fast, 45, fps), {}, "a beat already there");
  assert.deepEqual(addBeatAtPlayhead(fast, 10, fps), {});
});

test("snapping includes the beats of clips not being moved", () => {
  const fps = 30;
  const a = audio({ clipId: "a", beats: { manual: [1] } });
  const v = { ...audio({ clipId: "v", beats: { manual: [2] } }), type: "video" } as unknown as VideoClipProps;
  const beats = beatSnapPoints([a, v], fps, () => null, () => undefined, new Set(["v"]));
  assert.deepEqual(beats, [60]);
  const points = snapPoints([], { playhead: 0, markers: [], exclude: new Set(), beats });
  assert.ok(points.includes(60));
  // Without beats, as before.
  assert.deepEqual(snapPoints([], { playhead: 5, markers: [], exclude: new Set() }), [5]);
});

test("a file's beats are asked once, and asked again after a failure", async () => {
  forgetBeats();
  let asked = 0;
  const find = async (_p: string) => {
    asked++;
    if (asked === 1) throw new Error("no engine");
    return { bpm: 100, beats: [] };
  };
  assert.equal(await beatsOfFile("/s.mp3", find), null);
  assert.equal((await beatsOfFile("/s.mp3", find))!.bpm, 100);
  await beatsOfFile("/s.mp3", find);
  assert.equal(asked, 2);
});
