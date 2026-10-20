// Tests for src/lib/project-timelines.ts (several timelines per project: names, switching the
// content between the editor and the list, duplicating, deleting, and reading a project file,
// old ones included): `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterDelete,
  cloneTimelineContent,
  emptyContent,
  listFromDoc,
  nextTimelineName,
  park,
  renameIn,
  take,
  uniqueName,
  type ProjectTimeline,
  type TimelineContent,
} from "../src/lib/project-timelines.ts";
import type { AnyClipProps, TimelineProps } from "../src/lib/types.ts";

const track = (timelineId: string): TimelineProps => ({ timelineId, type: "media", timelineWidth: 0, timelineY: 0, timelineHeight: 0, timelinePadding: 0, muted: false, hidden: false });
const clip = (clipId: string, timelineId: string, extra: Record<string, unknown> = {}) => ({ clipId, timelineId, type: "video", startFrame: 0, endFrame: 30, ...extra }) as unknown as AnyClipProps;
const content = (extra: Partial<TimelineContent> = {}): TimelineContent => ({ ...emptyContent(), clips: [clip("c1", "t1")], timelines: [track("t1")], clipDuration: 30, ...extra });
const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};

test("timelines are named Timeline 01, 02, … taking the smallest free number", () => {
  assert.equal(nextTimelineName([]), "Timeline 01");
  assert.equal(nextTimelineName(["Timeline 01"]), "Timeline 02");
  assert.equal(nextTimelineName(["Timeline 01", "Timeline 03"]), "Timeline 02");
  assert.equal(nextTimelineName(["My cut", "timeline 02"]), "Timeline 01");
});

test("a name that's taken gets a number after it", () => {
  assert.equal(uniqueName("Cut", ["Rough"]), "Cut");
  assert.equal(uniqueName("Cut", ["cut"]), "Cut 2");
  assert.equal(uniqueName("Cut", ["Cut", "Cut 2"]), "Cut 3");
});

test("switching: the timeline left is parked with its content, the one opened is taken out of the list", () => {
  const a = content();
  const b = content({ clips: [clip("c2", "t2")], timelines: [track("t2")], playhead: 12 });
  let list: ProjectTimeline[] = [{ id: "A", name: "Timeline 01" }, { id: "B", name: "Timeline 02", content: b }];
  // Leave A (its content is what the editor holds), open B.
  list = park(list, "A", a);
  const opened = take(list, "B");
  assert.equal(opened.content, b);
  assert.equal(opened.list.find((t) => t.id === "B")!.content, undefined);
  assert.equal(opened.list.find((t) => t.id === "A")!.content, a);
  // And back: B's edits are parked, A's content comes out as it was.
  const edited = { ...b, playhead: 40 };
  const back = take(park(opened.list, "B", edited), "A");
  assert.equal(back.content, a);
  assert.equal(back.list.find((t) => t.id === "B")!.content!.playhead, 40);
  assert.equal(back.list.map((t) => t.name).join(), "Timeline 01,Timeline 02");
});

test("a new timeline comes out empty", () => {
  const out = take([{ id: "A", name: "Timeline 01" }, { id: "N", name: "Timeline 02", content: emptyContent() }], "N");
  assert.deepEqual(out.content.clips, []);
  assert.deepEqual(out.content.timelines, []);
  assert.equal(out.content.magnet, true);
});

test("duplicating copies every id and shares none", () => {
  const src = content({
    clips: [clip("c1", "t1", { linkId: "L" }), clip("c2", "t1", { linkId: "L" })],
    markers: [{ id: "m1", frame: 5, color: "#fff", note: "" }],
  });
  const copy = cloneTimelineContent(src, counter());
  const ids = (c: TimelineContent) => [...c.clips.map((x) => x.clipId), ...c.timelines.map((t) => t.timelineId), ...c.markers.map((m) => m.id)];
  const old = new Set(ids(src));
  assert.ok(ids(copy).every((id) => !old.has(id)));
  assert.equal(copy.clips.length, 2);
  assert.equal(copy.markers[0].frame, 5);
  assert.equal(copy.clips[0].timelineId, copy.timelines[0].timelineId);
  assert.equal(copy.clips[0].linkId, copy.clips[1].linkId);
  assert.notEqual(copy.clips[0].linkId, "L");
  // The original is untouched.
  assert.equal(src.clips[0].clipId, "c1");
});

test("renaming trims, ignores an empty name and keeps names unique", () => {
  const list: ProjectTimeline[] = [{ id: "A", name: "Timeline 01" }, { id: "B", name: "Timeline 02" }];
  assert.equal(renameIn(list, "A", "  Intro  ")[0].name, "Intro");
  assert.equal(renameIn(list, "A", "   "), list);
  assert.equal(renameIn(list, "A", "Timeline 01"), list);
  assert.equal(renameIn(list, "A", "Timeline 02")[0].name, "Timeline 02 2");
  assert.equal(renameIn(list, "Z", "x"), list);
});

test("deleting opens the next timeline, or the one before for the last; the only one stays", () => {
  const list: ProjectTimeline[] = [{ id: "A", name: "a" }, { id: "B", name: "b" }, { id: "C", name: "c" }];
  assert.equal(afterDelete(list, "A"), "B");
  assert.equal(afterDelete(list, "B"), "C");
  assert.equal(afterDelete(list, "C"), "B");
  assert.equal(afterDelete([{ id: "A", name: "a" }], "A"), null);
  assert.equal(afterDelete(list, "Z"), null);
});

test("a project file from before several timelines loads as one, Timeline 01", () => {
  const doc = { timeline: { tracks: [track("t1")], clips: [{ clipId: "c1" }], markers: [] } };
  const { list, active } = listFromDoc<{ clipId: string }>(doc, counter());
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Timeline 01");
  assert.equal(active, list[0].id);
  assert.equal(list[0].saved.clips.length, 1);
  assert.equal(list[0].saved.tracks[0].timelineId, "t1");
  // Not even a timeline: an empty one.
  assert.equal(listFromDoc({}, counter()).list[0].saved.clips.length, 0);
});

test("a file with several timelines lists them in order and opens the active one", () => {
  const doc = {
    timeline: { id: "A", name: "Main", tracks: [], clips: [{ clipId: "a" }] },
    moreTimelines: [
      { id: "B", name: "Cut 2", tracks: [], clips: [{ clipId: "b" }], playhead: 9 },
      { id: "B", name: "", tracks: [], clips: [] }, // a repeated id and a missing name are made good
    ],
    editorState: { activeTimeline: "B" },
  };
  const { list, active } = listFromDoc<{ clipId: string }>(doc, counter());
  assert.equal(active, "B");
  assert.deepEqual(list.map((t) => t.name), ["Main", "Cut 2", "Timeline 01"]);
  assert.equal(new Set(list.map((t) => t.id)).size, 3);
  assert.equal(list[1].saved.playhead, 9);
  // An active id the file doesn't have falls back to the first.
  assert.equal(listFromDoc({ ...doc, editorState: { activeTimeline: "nope" } }, counter()).active, "A");
});
