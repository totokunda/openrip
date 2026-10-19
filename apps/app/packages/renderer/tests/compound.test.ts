// Tests for src/lib/compound.ts (compound clips: creating one from clips, breaking it apart,
// copying it with fresh ids, and the timelines stack): `node --test tests/*.test.ts` in
// packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterEdit,
  allClips,
  breakApart,
  cloneContent,
  compoundMembers,
  contentLength,
  createCompound,
  foldStack,
  isCompound,
  nextCompoundName,
  trail,
  type CompoundClip,
  type CompoundFrame,
} from "../src/lib/compound.ts";
import type { AnyClipProps, TimelineProps } from "../src/lib/types.ts";

const track = (timelineId: string, type: TimelineProps["type"], extra: Partial<TimelineProps> = {}): TimelineProps => ({
  timelineId,
  type,
  timelineWidth: 0,
  timelineY: 0,
  timelineHeight: 0,
  timelinePadding: 0,
  muted: false,
  hidden: false,
  ...extra,
});
const clip = (clipId: string, timelineId: string, startFrame: number, endFrame: number, extra: Record<string, unknown> = {}) =>
  ({ clipId, timelineId, type: "video", assetId: `a-${clipId}`, startFrame, endFrame, trimStart: 0, trimEnd: 0, ...extra }) as unknown as AnyClipProps;

// Top to bottom, as the store lists them: text, overlay, main, audio.
const timelines = [track("tx", "text"), track("ov", "media"), track("main", "media"), track("au", "audio")];
const counter = () => {
  let n = 0;
  return () => `n${++n}`;
};
const world = { width: 1066, height: 600 };
// One counter for all, so the ids of different compounds in a test differ.
const fresh = counter();
const make = (clips: AnyClipProps[], ids: string[], extra = {}) => createCompound(clips, timelines, ids, { world, linkage: true, newId: fresh, ...extra });

test("a compound takes the clips' time range and puts them in its own timeline from 0", () => {
  const clips = [clip("a", "main", 10, 40), clip("b", "main", 40, 70), clip("t", "tx", 20, 50, { type: "text" }), clip("z", "main", 70, 90)];
  const done = make(clips, ["a", "b", "t"])!;
  const c = done.clips.find((x) => x.clipId === done.select[0]) as CompoundClip;
  assert.ok(isCompound(c));
  // Spans 10–70, on the main track (the lowest video track they used, free there).
  assert.deepEqual([c.timelineId, c.startFrame, c.endFrame, c.trimStart, c.trimEnd], ["main", 10, 70, 0, 0]);
  assert.equal(c.assetId, "");
  assert.deepEqual(c.transform, { x: 0, y: 0, width: 1066, height: 600, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 });
  // The members left the timeline; the clip after them stayed.
  assert.deepEqual(done.clips.map((x) => x.clipId).sort(), [c.clipId, "z"].sort());
  // Their times are relative to the compound's start, on tracks of its own (new ids, the kinds and order kept).
  assert.deepEqual(c.compound.clips.map((x) => [x.clipId, x.startFrame, x.endFrame]), [["a", 0, 30], ["b", 30, 60], ["t", 10, 40]]);
  assert.deepEqual(c.compound.timelines.map((t) => t.type), ["text", "media"]);
  assert.ok(c.compound.timelines.every((t) => !timelines.some((o) => o.timelineId === t.timelineId)));
  assert.equal(contentLength(c.compound), 60);
  // The clips are on the compound's own tracks.
  assert.equal(c.compound.clips.find((x) => x.clipId === "t")!.timelineId, c.compound.timelines[0].timelineId);
});

test("it goes on a new video track when the members' own has other clips in the way", () => {
  // The middle clip stays on the main track, so a compound over 0–90 can't go there.
  const clips = [clip("a", "main", 0, 30), clip("m", "main", 30, 60), clip("b", "main", 60, 90)];
  const done = make(clips, ["a", "b"])!;
  const c = done.clips.find((x) => x.clipId === done.select[0])!;
  assert.notEqual(c.timelineId, "main");
  const at = done.timelines.findIndex((t) => t.timelineId === c.timelineId);
  assert.equal(done.timelines[at].type, "media");
  // Just above the main track.
  assert.equal(done.timelines[at + 1].timelineId, "main");
});

test("linked clips and a group's clips go with the ones asked for; a locked track refuses", () => {
  const clips = [clip("v", "main", 0, 30, { linkId: "L" }), clip("s", "au", 0, 30, { type: "audio", linkId: "L" }), clip("o", "ov", 0, 30)];
  assert.deepEqual(compoundMembers(clips, ["v"], true).map((c) => c.clipId), ["v", "s"]);
  assert.deepEqual(compoundMembers(clips, ["v"], false).map((c) => c.clipId), ["v"]);
  const grouped = [clip("g", "ov", 0, 30, { type: "group", children: [["c1", "c2"]] }), clip("c1", "main", 0, 30, { groupId: "g", hidden: true }), clip("c2", "tx", 0, 30, { groupId: "g", hidden: true })];
  assert.deepEqual(compoundMembers(grouped, ["c1"], true).map((c) => c.clipId).sort(), ["c1", "c2", "g"]);
  const locked = [track("tx", "text"), track("main", "media", { locked: true })];
  assert.equal(createCompound([clip("a", "main", 0, 10)], locked, ["a"], { world, linkage: true, newId: fresh }), null);
  assert.equal(make(clips, []), null);
  // A link to a clip left behind isn't kept inside.
  const alone = make(clips, ["v"], { linkage: false })!;
  assert.equal((alone.clips.find((c) => isCompound(c)) as CompoundClip).compound.clips[0].linkId, undefined);
});

test("compounds are named in order, counting the ones inside others", () => {
  const inner = make([clip("a", "main", 0, 10)], ["a"])!;
  assert.equal((inner.clips[0] as CompoundClip).name, "Compound clip1");
  assert.equal(nextCompoundName(inner.clips), "Compound clip2");
  // Nested: a compound inside a compound's content counts too.
  const outer = { ...(inner.clips[0] as CompoundClip), name: "Compound clip2", compound: { clips: inner.clips, timelines } } as CompoundClip;
  assert.equal(nextCompoundName([outer]), "Compound clip3");
  assert.deepEqual(allClips([outer]).map((c) => c.clipId), [outer.clipId, inner.clips[0].clipId, "a"]);
});

test("break apart puts the content back at its place, tracks and all", () => {
  const clips = [clip("a", "main", 10, 40), clip("b", "main", 40, 70), clip("t", "tx", 20, 50, { type: "text" }), clip("au", "au", 10, 70, { type: "audio" })];
  const made = make(clips, ["a", "b", "t", "au"])!;
  const id = made.select[0];
  // Moved to 100 first, as if the compound had been dragged.
  const moved = made.clips.map((c) => (c.clipId === id ? { ...c, startFrame: 100, endFrame: 160 } : c));
  const done = breakApart(moved, made.timelines, id, { newId: fresh, fps: 30 })!;
  const at = (cid: string) => {
    const c = done.clips.find((x) => x.clipId === cid)!;
    return [c.startFrame, c.endFrame, done.timelines.find((t) => t.timelineId === c.timelineId)!.type];
  };
  assert.deepEqual(at("a"), [100, 130, "media"]);
  assert.deepEqual(at("b"), [130, 160, "media"]);
  assert.deepEqual(at("t"), [110, 140, "text"]);
  assert.deepEqual(at("au"), [100, 160, "audio"]);
  assert.ok(!done.clips.some((c) => c.clipId === id));
  assert.deepEqual([...done.select].sort(), ["a", "au", "b", "t"]);
  // The video clips share the compound's own track.
  assert.equal(done.clips.find((c) => c.clipId === "a")!.timelineId, done.clips.find((c) => c.clipId === "b")!.timelineId);
});

test("break apart of a trimmed compound brings the part it showed, cutting the clips at its ends", () => {
  const made = make([clip("a", "main", 0, 100, { trimStart: 5, trimEnd: -5 })], ["a"])!;
  const id = made.select[0];
  // Shows content frames 20–60, at 200.
  const trimmed = made.clips.map((c) => (c.clipId === id ? { ...c, startFrame: 200, endFrame: 240, trimStart: 20, trimEnd: -40 } : c));
  const done = breakApart(trimmed, made.timelines, id, { newId: fresh, fps: 30 })!;
  const a = done.clips.find((c) => c.clipId === "a")!;
  assert.deepEqual([a.startFrame, a.endFrame, a.trimStart, a.trimEnd], [200, 240, 25, -45]);
  // A clip wholly outside the part is left out.
  const two = make([clip("a", "main", 0, 30), clip("b", "main", 30, 100)], ["a", "b"])!;
  const cut = two.clips.map((c) => (isCompound(c) ? { ...c, startFrame: 0, endFrame: 20, trimStart: 40, trimEnd: -40 } : c));
  const gone = breakApart(cut, two.timelines, two.select[0], { newId: fresh, fps: 30 })!;
  assert.deepEqual(gone.clips.map((c) => c.clipId), ["b"]);
  assert.equal(breakApart(clips0(), timelines, "a", { newId: fresh, fps: 30 }), null);
});
const clips0 = () => [clip("a", "main", 0, 10)];

test("a copy of a compound shares no id with it, links and groups follow the new ids", () => {
  const made = make([clip("a", "main", 0, 30, { linkId: "L" }), clip("s", "au", 0, 30, { type: "audio", linkId: "L" }), clip("g", "ov", 0, 30, { type: "group", children: [["c"]] }), clip("c", "tx", 0, 30, { groupId: "g", type: "text" })], ["a", "g"])!;
  const original = (made.clips.find(isCompound) as CompoundClip).compound;
  const copy = cloneContent(original, fresh);
  const ids = (c: { clips: AnyClipProps[]; timelines: TimelineProps[] }) => [...c.clips.map((x) => x.clipId), ...c.timelines.map((t) => t.timelineId)];
  assert.equal(copy.clips.length, original.clips.length);
  assert.ok(ids(copy).every((id) => !ids(original).includes(id)));
  const [a, s, g, c] = ["a", "s", "g", "c"].map((id) => copy.clips[original.clips.findIndex((x) => x.clipId === id)]);
  assert.equal(a.linkId, s.linkId);
  assert.notEqual(a.linkId, "L");
  assert.deepEqual((g as any).children, [[c.clipId]]);
  assert.equal(c.groupId, g.clipId);
  // Each clip is on its copy of its track.
  for (const [i, x] of copy.clips.entries()) {
    const was = original.timelines.findIndex((t) => t.timelineId === original.clips[i].timelineId);
    assert.equal(x.timelineId, copy.timelines[was].timelineId);
  }
  // The original is untouched, and a compound inside is copied deep too.
  assert.equal(original.clips[0].clipId, "a");
  const nested = { ...(made.clips[0] as CompoundClip), compound: original } as CompoundClip;
  const deep = cloneContent({ clips: [nested], timelines }, fresh);
  assert.notEqual((deep.clips[0] as CompoundClip).compound.clips[0].clipId, "a");
});

test("the main timeline is folded from the timelines being edited", () => {
  const inner = make([clip("a", "main", 0, 30)], ["a"])!;
  const outerClips = inner.clips;
  const compoundId = outerClips[0].clipId;
  const frame: CompoundFrame = { clipId: compoundId, clips: outerClips, timelines: inner.timelines, clipDuration: 30, playhead: 7, length: 30, view: { total: 50, window: [0, 50], zoom: 1 } };
  // Editing inside: a clip added there.
  const edited = [...(outerClips[0] as CompoundClip).compound.clips, clip("n", "main", 30, 45)];
  const folded = foldStack([frame], edited, (outerClips[0] as CompoundClip).compound.timelines);
  assert.deepEqual((folded.clips[0] as CompoundClip).compound.clips.map((c) => c.clipId), ["a", "n"]);
  assert.equal(folded.timelines, inner.timelines);
  // Nothing open: as it is. Two levels: the inner one folds into the outer first.
  const same = foldStack([], edited, timelines);
  assert.equal(same.clips, edited);
  const outerOuter = make([...outerClips], [compoundId])!;
  const level2: CompoundFrame = { ...frame, clipId: outerOuter.select[0], clips: outerOuter.clips, timelines: outerOuter.timelines };
  const level1: CompoundFrame = { ...frame, clips: (outerOuter.clips[0] as CompoundClip).compound.clips, timelines: (outerOuter.clips[0] as CompoundClip).compound.timelines };
  const root = foldStack([level2, level1], edited, (outerClips[0] as CompoundClip).compound.timelines);
  const top = root.clips[0] as CompoundClip;
  assert.deepEqual(((top.compound.clips[0] as CompoundClip).compound.clips).map((c) => c.clipId), ["a", "n"]);
  assert.deepEqual(trail([level2, level1]).map((t) => t.name), ["Compound clip2", "Compound clip1"]);
});

test("a compound that played all of its content follows its new length; a trimmed one keeps its part", () => {
  const made = make([clip("a", "main", 0, 30)], ["a"])!;
  const c = made.clips[0] as CompoundClip;
  const longer = { clips: [...c.compound.clips, clip("n", c.compound.timelines[0].timelineId, 30, 50)], timelines: c.compound.timelines };
  const grown = afterEdit(c, longer, 30);
  assert.deepEqual([grown.startFrame, grown.endFrame, grown.trimEnd], [0, 50, 0]);
  const shorter = { clips: [clip("a", c.compound.timelines[0].timelineId, 0, 12)], timelines: c.compound.timelines };
  assert.equal(afterEdit(c, shorter, 30).endFrame, 12);
  // Trimmed to 10–25 of a 30-frame content: stays (cut only if the content no longer reaches it).
  const part = { ...c, startFrame: 100, endFrame: 115, trimStart: 10, trimEnd: -5 } as CompoundClip;
  const kept = afterEdit(part, longer, 30);
  assert.deepEqual([kept.startFrame, kept.endFrame], [100, 115]);
  assert.equal(afterEdit(part, shorter, 30).endFrame, 102);
});
