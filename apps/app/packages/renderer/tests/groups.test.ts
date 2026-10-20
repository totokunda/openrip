// Tests for Group, clips stuck together (src/lib/bundle.ts): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleMates, canGroup, groupTogether, migrateLegacyGroups, stickSelection, tidyBundles, ungroupTogether, withMates } from "../src/lib/bundle.ts";

const clip = (clipId: string, extra: Record<string, unknown> = {}) => ({ clipId, type: "video", timelineId: `t-${clipId}`, startFrame: 0, endFrame: 10, ...extra }) as any;
let n = 0;
const newId = () => `id${++n}`;
const ids = (cs: any[]) => cs.map((c) => c.clipId).join(",");

test("grouping sticks the clips together under one id and leaves them where they are", () => {
  const cs = [clip("a"), clip("b"), clip("c")];
  const out = groupTogether(cs, ["a", "b"], newId);
  assert.equal(out[0].bundleId, out[1].bundleId);
  assert.ok(out[0].bundleId);
  assert.equal(out[2].bundleId, undefined);
  assert.deepEqual(out.map((c) => c.timelineId), cs.map((c) => c.timelineId));
  assert.equal(ids(bundleMates(out, out[0])), "b");
});

test("Group needs two clips, not already one group, and none a template container", () => {
  const cs = [clip("a"), clip("b"), clip("g", { type: "group", children: [] })];
  assert.equal(canGroup(cs, ["a"]), false);
  assert.equal(canGroup(cs, ["a", "b"]), true);
  assert.equal(canGroup(cs, ["a", "g"]), false);
  const grouped = groupTogether(cs, ["a", "b"], newId);
  assert.equal(canGroup(grouped, ["a", "b"]), false);
});

test("picking one clip of a group picks the group", () => {
  const cs = groupTogether([clip("a"), clip("b"), clip("c")], ["a", "b"], newId);
  assert.equal(ids(withMates(cs, ["a"]).map((id) => ({ clipId: id }))), "a,b");
  assert.deepEqual(stickSelection(cs, ["a"]), ["a", "b"]);
  assert.deepEqual(stickSelection(cs, ["a", "c"]), ["a", "c", "b"]);
  assert.deepEqual(stickSelection(cs, ["c"]), ["c"]);
  assert.deepEqual(stickSelection([clip("x"), clip("y")], ["x"]), ["x"]);
});

test("ungrouping takes the group apart, whichever clip it's asked on", () => {
  const cs = groupTogether([clip("a"), clip("b"), clip("c")], ["a", "b", "c"], newId);
  const out = ungroupTogether(cs, ["b"]);
  assert.ok(out.every((c) => c.bundleId === undefined));
  assert.equal(ungroupTogether(out, ["a"]), out);
});

test("a group of one is no group", () => {
  const cs = groupTogether([clip("a"), clip("b")], ["a", "b"], newId);
  const out = tidyBundles(cs.filter((c: any) => c.clipId !== "b"));
  assert.equal(out[0].bundleId, undefined);
  assert.equal(tidyBundles(cs), cs);
});

test("a project saved with a group container opens with its clips stuck together; a template's stays", () => {
  const cs = [
    clip("a", { hidden: true, groupId: "G" }),
    clip("b", { hidden: true, groupId: "G" }),
    { clipId: "G", type: "group", timelineId: "tg", startFrame: 0, endFrame: 10, children: [["a"], ["b"]] },
    clip("p", { hidden: true, groupId: "T" }),
    { clipId: "T", type: "group", timelineId: "tt", startFrame: 0, endFrame: 10, children: [["p"]], template: { id: "x", name: "X" } },
  ] as any[];
  const out = migrateLegacyGroups(cs, newId);
  assert.equal(ids(out), "a,b,p,T");
  const [a, b, p] = out;
  assert.equal(a.hidden, false);
  assert.equal(a.groupId, undefined);
  assert.equal(a.bundleId, b.bundleId);
  assert.ok(a.bundleId);
  assert.equal(p.hidden, true);
  assert.equal(p.groupId, "T");
  assert.equal(migrateLegacyGroups(out, newId), out);
});
