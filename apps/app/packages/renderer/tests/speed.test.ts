// Tests for src/lib/speed.ts: `node --test tests/` in packages/renderer (Node strips the types
// itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURVE_PRESETS,
  curveAverage,
  curvedLength,
  curveSpeedAt,
  freezeFrame,
  presetCurve,
  reversePatch,
  sourceProgressAt,
  sourceTimeAt,
  speedPatch,
  splitCurveFields,
  splitSpeedCurve,
  timelineProgressAt,
} from "../src/lib/speed.ts";
import { splitKeyframes } from "../src/lib/keyframes.ts";
import type { AnyClipProps, AudioClipProps, VideoClipProps } from "../src/lib/types.ts";

const close = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("the remap is the engine's (its golden values)", () => {
  // engine/crates/model/src/speed.rs, printed: mean speed, source at 0.3, timeline at 0.3,
  // speed at 0.37.
  const golden: Record<string, number[]> = {
    Custom: [1, 0.3, 0.3, 1],
    Montage: [1.45342499301867711, 0.44255656986443681, 0.26614476850243873, 0.50193013741898818],
    Hero: [1.81395338475704193, 0.44025754008036294, 0.24131135920360913, 0.5],
    Bullet: [2.80937188209066591, 0.46440487470706027, 0.16207915245053861, 0.5],
    "Jump Cut": [0.67761802765745571, 0.26563638870313877, 0.33880900293588645, 0.6],
    "Flash In": [1.84692946551563608, 0.6209925725413048, 0.10655362522945955, 1],
    "Flash Out": [1.84692918388370231, 0.16243177939382011, 0.55407876670360567, 1],
  };
  for (const p of CURVE_PRESETS) {
    const [avg, src, tl, v] = golden[p.name];
    close(curveAverage(p.points), avg, 1e-12, `${p.name} mean`);
    close(sourceProgressAt(p.points, 0.3), src, 1e-12, `${p.name} source`);
    close(timelineProgressAt(p.points, 0.3), tl, 1e-12, `${p.name} timeline`);
    close(curveSpeedAt(p.points, 0.37), v, 1e-12, `${p.name} speed`);
  }
});

test("CapCut's mean speed for a cached draft's curve", () => {
  // The draft stores `speed` 0.742763028661908 with these points.
  const points = [
    { x: 0, y: 1 },
    { x: 0.909861572568959, y: 1.000001072883606 },
    { x: 0.966685242093924, y: 0.100000001490116 },
    { x: 1, y: 0.100000001490116 },
  ];
  close(curveAverage(points), 0.742763028661908, 1e-15, "mean");
  // A 10 s clip of media takes media / mean on the timeline (frames at 30 fps).
  assert.equal(curvedLength(300, points), Math.round(300 / 0.742763028661908));
});

test("the two directions agree, and time never runs backward", () => {
  for (const p of CURVE_PRESETS) {
    let last = 0;
    for (let i = 0; i <= 200; i++) {
      const q = i / 200;
      const s = sourceProgressAt(p.points, q);
      close(timelineProgressAt(p.points, s), q, 1e-9, `${p.name} at ${q}`);
      assert.ok(s >= last, `${p.name} backward at ${q}`);
      last = s;
    }
  }
});

const video = (over: Partial<VideoClipProps> = {}): VideoClipProps =>
  ({ clipId: "v", type: "video", timelineId: "t", assetId: "a", assetIdHistory: [], masks: [], startFrame: 30, endFrame: 150, trimStart: 60, trimEnd: -90, speed: 1, ...over }) as VideoClipProps;

test("source time at a clip time: speed, curve, reverse and freeze", () => {
  const fps = 30;
  // 2 s trimmed off the start, at 2×: 4 s in, then 2 s of media a second.
  const v = video({ speed: 2 });
  close(sourceTimeAt(v, 0, fps), 4, 1e-9, "in-point");
  close(sourceTimeAt(v, 15, fps), 5, 1e-9, "half a second in");
  // Reversed in a 20 s asset: from its end, back.
  const r = video({ speed: 2, reverse: true });
  close(sourceTimeAt(r, 0, fps, 20), 16, 1e-9, "reversed in-point");
  close(sourceTimeAt(r, 15, fps, 20), 15, 1e-9, "reversed half a second in");
  // A curve: the media its remap reaches.
  const curve = presetCurve("Flash In")!;
  const c = video({ speedCurve: curve, speed: curveAverage(curve.points) });
  const len = 120;
  const media = (len * c.speed!) / fps;
  close(sourceTimeAt(c, 36, fps), (60 * c.speed!) / fps + sourceProgressAt(curve.points, 0.3) * media, 1e-9, "curved");
  // A freeze frame holds its frame.
  close(sourceTimeAt(video({ freeze: { at: 7.25 } }), 99, fps), 7.25, 0, "freeze");
});

test("a speed change keeps the in-point and the media, and keys stay on it", () => {
  const keys = { opacity: [{ frame: 0, value: 100 }, { frame: 60, value: 0, ease: { out: { frames: 10, value: 0 }, in: { frames: -10, value: 0 } } }] };
  const v = video({ keyframes: keys });
  const p = speedPatch(v, { speed: 2 }) as Partial<VideoClipProps>;
  assert.equal(p.endFrame, 30 + 60);
  assert.equal(p.trimStart, 30);
  assert.equal(p.trimEnd, -45);
  assert.equal(p.speedCurve, null);
  assert.deepEqual(p.keyframes!.opacity!.map((k) => k.frame), [0, 30]);
  // The original object wasn't touched (the undo history shares it).
  assert.equal(v.keyframes!.opacity![1].frame, 60);
  // A curve: its mean speed, and keys where the curve shows their media.
  const curve = presetCurve("Montage")!;
  const q = speedPatch(v, { curve }) as Partial<VideoClipProps>;
  const avg = curveAverage(curve.points);
  assert.equal(q.speed, avg);
  assert.equal(q.endFrame, 30 + Math.round(120 / avg));
  const len = q.endFrame! - 30;
  close(q.keyframes!.opacity![1].frame, timelineProgressAt(curve.points, 0.5) * len, 1e-9, "key on its media");
  // Taken off again: the plain speed it averaged, the key back where it was (to rounding).
  const back = speedPatch({ ...v, ...q } as VideoClipProps, { curve: null }) as Partial<VideoClipProps>;
  assert.equal(back.speedCurve, null);
  close(back.keyframes!.opacity![1].frame * (back.speed! / 1), 60, 1, "key back");
});

test("reversing swaps the trims (they count as it plays), and twice is nothing", () => {
  const v = video();
  const r = { ...v, ...reversePatch(v, true) } as VideoClipProps;
  assert.equal(r.reverse, true);
  assert.equal(r.trimStart, 90);
  assert.equal(r.trimEnd, -60);
  assert.deepEqual(reversePatch(r, true), {});
  const back = { ...r, ...reversePatch(r, false) } as VideoClipProps;
  assert.equal(back.trimStart, 60);
  assert.equal(back.trimEnd, -90);
  // The same media either way: reversed, the clip starts where it ended (in
  // a 9 s asset at 30 fps: trimmed 2 s and 3 s, 4 s long).
  close(sourceTimeAt(r, 0, 30, 9), sourceTimeAt(v, 120, 30), 1e-9, "starts where it ended");
});

test("a curved clip cut in two plays the same media at the same times", () => {
  const fps = 30;
  const curve = presetCurve("Hero")!;
  const c = video({ speedCurve: curve, speed: curveAverage(curve.points), trimStart: 15, trimEnd: -40 });
  const cut = 50;
  const [lp, rp] = splitCurveFields(c, cut)!;
  const left = { ...c, ...lp, endFrame: 30 + cut } as VideoClipProps;
  const right = { ...c, ...rp, startFrame: 30 + cut } as VideoClipProps;
  for (const f of [0, 10, 25, 49]) close(sourceTimeAt(left, f, fps), sourceTimeAt(c, f, fps), 0.012, `left ${f}`);
  for (const f of [50, 70, 100, 119]) close(sourceTimeAt(right, f - cut, fps), sourceTimeAt(c, f, fps), 0.012, `right ${f}`);
  // The media after each half's end, as the trims say.
  close(-left.trimEnd! * left.speed! + (cut * left.speed!), -c.trimEnd! * c.speed! + 120 * c.speed!, 1e-6, "left's media after");
  // Each half's points span its own media, the cut at CapCut's smooth step.
  const [a, b] = splitSpeedCurve(curve, 0.3);
  assert.equal(a.points[a.points.length - 1].x, 1);
  assert.equal(b.points[0].x, 0);
  assert.equal(a.points[a.points.length - 1].y, b.points[0].y);
  const u = (0.3 - 0.05) / (0.35 - 0.05);
  close(b.points[0].y, 1 + 4.5 * (3 * u * u - 2 * u * u * u), 1e-12, "speed at the cut");
});

test("freeze frame: cut, a 3 s still of the frame at the playhead, the rest later", () => {
  const fps = 30;
  let n = 0;
  const id = () => `id${++n}`;
  // The store's split: halves with new ids, the right one further into the media.
  const split = (c: AnyClipProps, f: number): [AnyClipProps, AnyClipProps] => {
    const rel = f - (c.startFrame ?? 0);
    const [lk, rk] = c.keyframes ? splitKeyframes(c.keyframes, rel, fps) : [undefined, undefined];
    return [
      { ...c, clipId: id(), endFrame: f, trimEnd: (c.trimEnd ?? 0) + (f - (c.endFrame ?? 0)), keyframes: lk },
      { ...c, clipId: id(), startFrame: f, trimStart: (c.trimStart ?? 0) + rel, keyframes: rk },
    ];
  };
  const v = video({ linkId: "L", keyframes: { opacity: [{ frame: 0, value: 100 }, { frame: 120, value: 0 }] } });
  const audio = { clipId: "au", type: "audio", timelineId: "ta", assetId: "a", startFrame: 30, endFrame: 150, trimStart: 60, trimEnd: -90, linkId: "L" } as AudioClipProps;
  const after = video({ clipId: "next", startFrame: 150, endFrame: 200 });
  const other = video({ clipId: "elsewhere", timelineId: "t2", startFrame: 100, endFrame: 200 });
  const done = freezeFrame([v, audio, after, other], "v", 90, fps, split, id, [audio])!;
  const still = done.clips.find((c) => c.clipId === done.freezeId) as VideoClipProps;
  assert.equal(still.startFrame, 90);
  assert.equal(still.endFrame, 90 + 90);
  // The frame at the playhead: 2 s in + 2 s played (and CapCut's 0.8 ms snap).
  close(still.freeze!.at, 4.0008, 1e-9, "frozen frame");
  assert.equal(still.linkId, undefined);
  assert.deepEqual(still.keyframes, { opacity: [{ frame: 0, value: 50 }] });
  const on = (track: string) => done.clips.filter((c) => c.timelineId === track && c.clipId !== still.clipId).sort((a, b) => a.startFrame - b.startFrame);
  // The video: left half, then the right half and the next clip 3 s later.
  assert.deepEqual(on("t").map((c) => [c.startFrame, c.endFrame]), [[30, 90], [180, 240], [240, 290]]);
  // Its audio is cut and moved with it, links kept per side; another track stays.
  assert.deepEqual(on("ta").map((c) => [c.startFrame, c.endFrame]), [[30, 90], [180, 240]]);
  const [vl, vr] = on("t");
  const [al, ar] = on("ta");
  assert.ok(vl.linkId && vl.linkId === al.linkId && vr.linkId === ar.linkId && vl.linkId !== vr.linkId);
  assert.deepEqual(on("t2").map((c) => [c.startFrame, c.endFrame]), [[100, 200]]);
  // Not a video, a freeze already, or outside the clip: nothing.
  assert.equal(freezeFrame([audio], "au", 90, fps, split, id), null);
  assert.equal(freezeFrame([still], still.clipId, 100, fps, split, id), null);
  assert.equal(freezeFrame([v], "v", 150, fps, split, id), null);
});
