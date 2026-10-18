// Tests for src/lib/keyframes.ts: `node --test tests/` in packages/renderer (Node strips the
// types itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capcutCurve,
  editProperty,
  keyframeAt,
  keyframeFrames,
  removeKeyframe,
  sampleKeyframes,
  scaleKeyframes,
  setKeyframe,
  setKeyframeEase,
  shiftKeyframes,
  splitKeyframes,
  toggleKeyframe,
  valueAt,
} from "../src/lib/keyframes.ts";

const bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0];

test("CapCut's curve, bit for bit with CapCut's own (the engine's golden values)", () => {
  const cases: [number[], number][] = [
    [[0, 0, 400000, 0, 600000, 1, 1000000, 1, 0.25], 0x3e0a6dc2],
    [[0, 0, 400000, 0, 600000, 1, 1000000, 1, 0.1], 0x3cae7f88],
    [[1000000, 0.5, 1300000, 2.5, 1700000, 2.5, 2000000, 0.5, 0.37], 0x3ff42895],
    [[0, -1, 0, -1, 0, 2, 33333, 2, 0.6], 0x3fe6c3c5],
    [[15179338.0, 0.047634556889534, 15346005.0, 0.047634556889534, 15429338.0, 1.1719075441360474, 15596005.0, 1.1719075441360474, 0.38176530599594116], 0x3eca2782],
    [[0.0, -1.9977422952651978, 400000.0, -1.9977422952651978, 1000000.0, -1.398311734199524, 1000000.0, -1.398311734199524, 0.35496899485588074], 0xbff1c027],
    [[0.0, 1.0, 0.0, 1.0, 19999.80078125, 1.0, 33333.0, 1.0, 0.8046080470085144], 0x3f800000],
    [[41802224.0, 59.03871154785156, 41802248.0, 11.93923568725586, 41802212.0, 85.05232238769531, 41802240.0, 88.49005889892578, 0.5], 0x423f2360],
    [[9945240.0, 84.83952331542969, 9945240.0, 84.83952331542969, 9945257.0, 9.028807640075684, 9945257.0, 9.028807640075684, 1.9999999949504854e-6], 0x42a9add4],
    [[3607872.0, 28.849140167236328, 3607875.0, 62.191898345947266, 3607874.75, -5.928699493408203, 3607874.0, -0.5163931846618652, 4.999999987376214e-7], 0x41e6cb0a],
  ];
  for (const [v, want] of cases) {
    const y = capcutCurve([[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]], v[8]);
    assert.equal(bits(y), want, `${v}: ${y}`);
  }
});

test("adding, replacing and removing keys never touches what it's given", () => {
  const none = undefined;
  const a = setKeyframe(none, "opacity", 10, 50);
  const b = setKeyframe(a, "opacity", 0, 100, "easeIn");
  const c = setKeyframe(b, "opacity", 10, 20);
  assert.deepEqual(a, { opacity: [{ frame: 10, value: 50 }] });
  assert.deepEqual(b.opacity?.map((k) => k.frame), [0, 10]);
  // Replacing keeps the easing; an empty list goes away.
  const d = setKeyframeEase(c, "opacity", 10, "hold");
  assert.deepEqual(setKeyframe(d, "opacity", 10, 30).opacity?.[1], { frame: 10, value: 30, ease: "hold" });
  assert.equal(keyframeAt(b, "opacity", 0)?.ease, "easeIn");
  assert.deepEqual(removeKeyframe(removeKeyframe(b, "opacity", 0), "opacity", 10), {});
  assert.deepEqual(keyframeFrames({ ...b, position: [{ frame: 10, value: [0, 0] }, { frame: 4, value: [0, 0] }] }), [0, 4, 10]);
});

test("sampling: ends hold, linear, hold, CapCut's presets, colours and volume as the engine moves them", () => {
  const fps = 30;
  const keys = [
    { frame: 0, value: 0 },
    { frame: 30, value: 100, ease: "hold" as const },
    { frame: 60, value: 0, ease: "easeInOut" as const },
    { frame: 90, value: 100 },
  ];
  assert.equal(sampleKeyframes(keys, -5, "opacity", fps), 0);
  assert.equal(sampleKeyframes(keys, 15, "opacity", fps), 50);
  assert.equal(sampleKeyframes(keys, 45, "opacity", fps), 100);
  // The default curve: the middle at the middle, slow at both ends.
  assert.ok(Math.abs((sampleKeyframes(keys, 75, "opacity", fps) as number) - 50) < 1e-4);
  assert.ok((sampleKeyframes(keys, 63, "opacity", fps) as number) < 10 * 0.5);
  assert.equal(sampleKeyframes(keys, 200, "opacity", fps), 100);
  // Colours travel in 0–1 channels and come back as hex.
  assert.equal(sampleKeyframes([{ frame: 0, value: "#ff0000" }, { frame: 10, value: "#0000ff" }], 5, "color", 25), "#800080");
  // Volume travels as gain: halfway from −20 dB (0.1) to 0 dB (1) is 0.55, −5.19 dB.
  const db = sampleKeyframes([{ frame: 0, value: -20 }, { frame: 10, value: 0 }], 5, "volume", 25) as number;
  assert.ok(Math.abs(db - 20 * Math.log10(0.55)) < 1e-9, `${db}`);
  // Two components, each its own curve.
  const p = sampleKeyframes([{ frame: 0, value: [0, 0], ease: "easeIn" as const }, { frame: 30, value: [100, 10] }], 15, "position", fps) as number[];
  assert.ok(p[0] < 50 && p[1] < 5);
});

test("a custom curve's handles: frames and the property's units, through decibels too", () => {
  const fps = 24;
  // A bump between equal values: at s = 0.5, 1 + 0.75 × 2.
  const bump = [{ frame: 0, value: 1, ease: { out: { frames: 7.2, value: 2 }, in: { frames: -7.2, value: 2 } } }, { frame: 24, value: 1 }];
  assert.ok(Math.abs((sampleKeyframes(bump, 12, "rotation", fps) as number) - 2.5) < 1e-5);
});

test("splitting keeps the motion on both sides, with a key at the cut", () => {
  const fps = 30;
  const keyframes = {
    opacity: [{ frame: 0, value: 0 }, { frame: 30, value: 100 }],
    rotation: [{ frame: 0, value: 0, ease: "easeInOut" as const }, { frame: 60, value: 90 }],
    position: [{ frame: 40, value: [0, 0] }, { frame: 50, value: [10, 10] }],
  };
  const [left, right] = splitKeyframes(keyframes, 20, fps);
  for (const f of [0, 5, 10, 19]) {
    for (const p of ["opacity", "rotation"] as const) {
      const want = sampleKeyframes(keyframes[p], f, p, fps) as number;
      assert.ok(Math.abs((sampleKeyframes(left![p]!, f, p, fps) as number) - want) < 0.05, `${p} left ${f}`);
    }
  }
  for (const f of [20, 30, 45, 59]) {
    for (const p of ["opacity", "rotation"] as const) {
      const want = sampleKeyframes(keyframes[p], f, p, fps) as number;
      assert.ok(Math.abs((sampleKeyframes(right![p]!, f - 20, p, fps) as number) - want) < 0.05, `${p} right ${f}`);
    }
  }
  assert.deepEqual(left!.opacity, [{ frame: 0, value: 0 }, { frame: 20, value: (sampleKeyframes(keyframes.opacity, 20, "opacity", fps) as number) }]);
  // Keys all after the cut: the left holds the first value, the right keeps them moved.
  assert.deepEqual(right!.position!.map((k) => k.frame), [0, 20, 30]);
  assert.deepEqual(left!.position, [{ frame: 20, value: [0, 0] }]);
});

test("a trim moves the keys with the content, a speed change scales them", () => {
  const keyframes = { opacity: [{ frame: 10, value: 0, ease: { out: { frames: 4, value: 0 }, in: { frames: -4, value: 0 } } }, { frame: 20, value: 100 }] };
  assert.deepEqual(shiftKeyframes(keyframes, -5)!.opacity!.map((k) => k.frame), [5, 15]);
  const twice = scaleKeyframes(keyframes, 0.5)!;
  assert.deepEqual(twice.opacity!.map((k) => k.frame), [5, 10]);
  assert.deepEqual((twice.opacity![0].ease as any).out.frames, 2);
  assert.equal(shiftKeyframes(undefined, 3), undefined);
});

test("editing a keyed property sets a key at the playhead; an unkeyed one its field", () => {
  const clip: any = {
    clipId: "c",
    type: "video",
    startFrame: 100,
    endFrame: 200,
    transform: { x: 0, y: 0, width: 200, height: 100, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 },
    keyframes: { opacity: [{ frame: 0, value: 100 }] },
  };
  assert.deepEqual(editProperty(clip, "opacity", 130, 40), { keyframes: { opacity: [{ frame: 0, value: 100 }, { frame: 30, value: 40 }] } });
  // Unkeyed: the field. Position is the box's centre; a turn keeps it.
  const moved = editProperty(clip, "position", 130, [150, 60]) as any;
  assert.deepEqual([moved.transform.x, moved.transform.y], [50, 10]);
  const turned = editProperty(clip, "rotation", 130, 90) as any;
  assert.ok(Math.abs(turned.transform.x - 150) < 1e-9 && Math.abs(turned.transform.y - -50) < 1e-9, JSON.stringify(turned.transform));
  // The diamond: a key with the value at the playhead, then without it.
  const on = toggleKeyframe(clip, "position", 110, 30) as any;
  assert.deepEqual(on.keyframes.position, [{ frame: 10, value: [100, 50] }]);
  assert.deepEqual(toggleKeyframe({ ...clip, ...on }, "position", 110, 30), { keyframes: { opacity: [{ frame: 0, value: 100 }] } });
  assert.equal(valueAt(clip, "opacity", 150, 30), 100);
});
