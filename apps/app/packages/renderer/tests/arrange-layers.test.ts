// Tests for Arrange layers' track bands (src/lib/arrange-layers.ts): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangeTracks, bandOf, isArranged } from "../src/lib/arrange-layers.ts";

const track = (timelineId: string, type: string) => ({ timelineId, type, timelineY: 0, timelineHeight: 54, timelinePadding: 0, timelineWidth: 0, muted: false, hidden: false }) as any;
const ids = (ts: any[]) => ts.map((t) => t.timelineId).join(",");

test("the bands run text, stickers, effects, overlays, main, audio", () => {
  const ts = [track("a", "audio"), track("m", "media"), track("f", "filter"), track("s", "sticker"), track("t", "text")];
  assert.equal(ids(arrangeTracks(ts)), "t,s,f,m,a");
});

test("shapes and drawings share the sticker band", () => {
  assert.equal(bandOf(track("x", "shape")), bandOf(track("y", "sticker")));
  assert.equal(bandOf(track("x", "draw")), bandOf(track("y", "sticker")));
});

test("each band keeps the order it had, so the main track stays the lowest video track", () => {
  const ts = [track("o1", "media"), track("t1", "text"), track("o2", "media"), track("t2", "text"), track("main", "media"), track("au", "audio")];
  assert.equal(ids(arrangeTracks(ts)), "t1,t2,o1,o2,main,au");
});

test("tracks already in their bands come back as the same array", () => {
  const ts = [track("t", "text"), track("m", "media"), track("a", "audio")];
  assert.equal(arrangeTracks(ts), ts);
  assert.ok(isArranged(ts));
  assert.ok(!isArranged([track("m", "media"), track("t", "text")]));
});
