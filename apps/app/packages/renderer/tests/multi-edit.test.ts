// Tests for src/lib/multi-edit.ts (what one clip's edit changed, made on the others):
// `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyKeys, applyLeaves, keyDiff, leafDiff, shared } from "../src/lib/multi-edit.ts";

test("only the leaves that changed are found", () => {
  const before = { adjust: { brightness: 5, contrast: 2 }, curves: { luma: [[0, 0], [1, 1]] }, lut: null };
  const after = { adjust: { brightness: 9, contrast: 2 }, curves: { luma: [[0, 0], [0.5, 0.6], [1, 1]] }, lut: null };
  assert.deepEqual(leafDiff(before, after), [
    { path: ["adjust", "brightness"], value: 9 },
    { path: ["curves", "luma"], value: [[0, 0], [0.5, 0.6], [1, 1]] },
  ]);
  assert.deepEqual(leafDiff(before, before), []);
  assert.deepEqual(leafDiff(undefined, 4), [{ path: [], value: 4 }]);
});

test("the leaves are set on another clip's field and the rest of it stays", () => {
  const other = { adjust: { brightness: -3, contrast: 7 }, hsl: { red: { hue: 1 } } };
  const next = applyLeaves(other, [{ path: ["adjust", "brightness"], value: 9 }]) as typeof other;
  assert.deepEqual(next, { adjust: { brightness: 9, contrast: 7 }, hsl: { red: { hue: 1 } } });
  // The other clip's object wasn't changed, and a missing field is made.
  assert.equal(other.adjust.brightness, -3);
  assert.deepEqual(applyLeaves(undefined, [{ path: ["adjust", "hue"], value: 4 }]), { adjust: { hue: 4 } });
  // A leaf that went away goes away.
  assert.deepEqual(applyLeaves(other, [{ path: ["hsl", "red"], value: undefined }]), { adjust: { brightness: -3, contrast: 7 }, hsl: {} });
  assert.equal(applyLeaves(1, [{ path: [], value: 2 }]), 2);
});

test("a shared value is the first one's, mixed when any differs", () => {
  assert.deepEqual(shared([100, 100, 100.001]), { value: 100, mixed: false });
  assert.deepEqual(shared([100, 50]), { value: 100, mixed: true });
  assert.deepEqual(shared([]), { value: 0, mixed: false });
});

test("keyframe lists that changed are copied, others left", () => {
  const was = { "adjust:brightness": [{ frame: 0, value: 1 }], position: [{ frame: 0, value: [1, 1] }] } as any;
  const now = { "adjust:brightness": [{ frame: 0, value: 1 }, { frame: 9, value: 4 }], position: [{ frame: 0, value: [2, 2] }] } as any;
  const changes = keyDiff(was, now, (p) => p.startsWith("adjust:"));
  assert.deepEqual(Object.keys(changes), ["adjust:brightness"]);
  const mine = { "adjust:brightness": [{ frame: 3, value: 0 }], rotation: [{ frame: 0, value: 5 }] } as any;
  assert.deepEqual(applyKeys(mine, changes), { "adjust:brightness": [{ frame: 0, value: 1 }, { frame: 9, value: 4 }], rotation: [{ frame: 0, value: 5 }] });
  // A list that went away is removed, and none left is no keyframes at all.
  const gone = keyDiff(now, {}, (p) => p.startsWith("adjust:"));
  assert.equal(gone["adjust:brightness"], undefined);
  assert.equal(applyKeys({ "adjust:brightness": [{ frame: 0, value: 1 }] } as any, gone), undefined);
});
