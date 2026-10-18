// Tests for the one-click colour tools and Split scenes' frames: src/lib/color-tools.ts.
// `node --test tests/` in packages/renderer (Node strips the types itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisRange,
  applyAutoAdjust,
  applyColorMatch,
  consistentOffPatches,
  consistentOn,
  consistentPatches,
  consistentReference,
  consistentReferenceId,
  lookOf,
  mainTrackClips,
  matchForEngine,
  removeAutoAdjust,
  removeColorMatch,
  sceneCutFrames,
  setAutoIntensity,
  setMatchIntensity,
} from "../src/lib/color-tools.ts";
import type { AnyClipProps, ColorMoments, TimelineProps, VideoClipProps } from "../src/lib/types.ts";

const video = (over: Partial<VideoClipProps> = {}): VideoClipProps =>
  ({ clipId: "v", timelineId: "main", type: "video", assetId: "a", startFrame: 30, endFrame: 330, trimStart: 0, trimEnd: 0, speed: 1, ...over }) as VideoClipProps;
const apply = (clip: AnyClipProps, patch: Partial<AnyClipProps>) => ({ ...clip, ...patch }) as AnyClipProps;
const adjustOf = (clip: AnyClipProps) => (clip as VideoClipProps).color?.adjust ?? {};

test("auto adjust adds its values to the sliders and takes only those off again", () => {
  let clip: AnyClipProps = video({ color: { adjust: { brightness: 5, sharpen: 20 } } });
  clip = apply(clip, applyAutoAdjust(clip, { brightness: 12, temperature: -8, whites: 0 }, 100, [0, 10]));
  assert.deepEqual(adjustOf(clip), { brightness: 17, sharpen: 20, temperature: -8 });
  // The user moves temperature on their own; half intensity rescales only auto's part.
  clip = apply(clip, { color: { ...(clip as VideoClipProps).color, adjust: { ...adjustOf(clip), temperature: -3 } } } as Partial<AnyClipProps>);
  clip = apply(clip, setAutoIntensity(clip, 50));
  assert.deepEqual(adjustOf(clip), { brightness: 11, sharpen: 20, temperature: 1 });
  assert.equal((clip as VideoClipProps).color?.auto?.intensity, 50);
  // Off: the user's own values stay (brightness 5, their +5 temperature).
  clip = apply(clip, removeAutoAdjust(clip));
  assert.deepEqual(adjustOf(clip), { brightness: 5, sharpen: 20, temperature: 5 });
  assert.equal((clip as VideoClipProps).color?.auto, null);
});

test("auto adjust keeps each slider in its range and remembers what it really added", () => {
  let clip: AnyClipProps = video({ color: { adjust: { brightness: 45 } } });
  clip = apply(clip, applyAutoAdjust(clip, { brightness: 20 }));
  assert.equal(adjustOf(clip).brightness, 50);
  assert.equal((clip as VideoClipProps).color?.auto?.applied.brightness, 5);
  clip = apply(clip, removeAutoAdjust(clip));
  assert.equal(adjustOf(clip).brightness, 45);
  // A text has no colour tools.
  assert.deepEqual(applyAutoAdjust({ clipId: "t", type: "text" } as AnyClipProps, { brightness: 3 }), {});
});

const m = (l: number): ColorMoments => ({ mean: [l, 0.01, -0.02], std: [0.2, 0.03, 0.04] });

test("color match keeps both clips' statistics, its intensity and its reference", () => {
  let clip: AnyClipProps = video();
  clip = apply(clip, applyColorMatch(clip, m(0.5), m(0.7), { clipId: "r", name: "ref.mov" }, 80));
  const match = (clip as VideoClipProps).color?.match;
  assert.deepEqual(match?.ref, { clipId: "r", name: "ref.mov" });
  assert.equal(match?.intensity, 80);
  clip = apply(clip, setMatchIntensity(clip, 130));
  assert.equal((clip as VideoClipProps).color?.match?.intensity, 100);
  assert.deepEqual(matchForEngine(clip), { sourceMean: [0.5, 0.01, -0.02], sourceStd: [0.2, 0.03, 0.04], referenceMean: [0.7, 0.01, -0.02], referenceStd: [0.2, 0.03, 0.04], intensity: 1 });
  clip = apply(clip, removeColorMatch(clip));
  assert.equal((clip as VideoClipProps).color?.match, null);
  assert.equal(matchForEngine(clip), null);
});

test("make colors consistent matches every main-track clip but the reference, and comes off", () => {
  const timelines = [{ timelineId: "over", type: "media" }, { timelineId: "main", type: "media" }] as TimelineProps[];
  let clips: AnyClipProps[] = [
    video({ clipId: "a", startFrame: 0, endFrame: 100 }),
    video({ clipId: "b", startFrame: 100, endFrame: 200 }),
    video({ clipId: "c", startFrame: 200, endFrame: 300 }),
    video({ clipId: "o", timelineId: "over", startFrame: 0, endFrame: 100 }),
  ];
  assert.deepEqual(mainTrackClips(clips, timelines).map((c) => c.clipId), ["a", "b", "c"]);
  assert.equal(consistentReference(clips, timelines, 150)?.clipId, "b");
  assert.equal(consistentReference(clips, timelines, 999)?.clipId, "a");
  const patches = consistentPatches(clips, timelines, "b", { a: m(0.4), b: m(0.6), c: m(0.8), o: m(0.5) }, "b.mov");
  assert.deepEqual(patches.map(([id]) => id), ["a", "c"]);
  clips = clips.map((c) => apply(c, Object.fromEntries(patches)[c.clipId] ?? {}));
  assert.ok(consistentOn(clips, timelines));
  assert.equal(consistentReferenceId(clips, timelines), "b");
  const a = (clips[0] as VideoClipProps).color?.match;
  assert.deepEqual([a?.source.mean[0], a?.reference.mean[0], a?.consistent], [0.4, 0.6, true]);
  // A match the user made on the overlay isn't touched by turning it off.
  clips[3] = apply(clips[3], applyColorMatch(clips[3], m(0.5), m(0.6), { clipId: "b" }));
  const off = consistentOffPatches(clips, timelines);
  assert.deepEqual(off.map(([id]) => id), ["a", "c"]);
  clips = clips.map((c) => apply(c, Object.fromEntries(off)[c.clipId] ?? {}));
  assert.ok(!consistentOn(clips, timelines));
  assert.ok((clips[3] as VideoClipProps).color?.match);
});

test("a reference is read through its match and the sliders the engine can follow", () => {
  assert.equal(lookOf(video()), null);
  let ref: AnyClipProps = video({ color: { adjust: { brightness: 10, temperature: -5, sharpen: 30, fade: 20 } } });
  assert.deepEqual(lookOf(ref), { brightness: 10, temperature: -5, matched: null });
  ref = apply(ref, applyColorMatch(ref, m(0.5), m(0.6), { clipId: "x" }, 50, true));
  assert.equal(lookOf(ref)?.matched?.intensity, 0.5);
  // Becoming Make colors consistent's reference, its consistent match is going.
  assert.equal(lookOf(ref, true)?.matched, null);
});

test("split scenes splits where each shot starts, inside the clip, at its speed and trim", () => {
  const fps = 30;
  // From 1 s into the media (trimStart 30 frames), on the timeline from frame 30.
  const clip = video({ startFrame: 30, endFrame: 330, trimStart: 30 });
  // Cuts at 2 s and 4.5 s of media: 1 s and 3.5 s into the clip; one before it, one after it.
  assert.deepEqual(sceneCutFrames(clip, [500_000, 2_000_000, 4_500_000, 20_000_000], fps), [60, 135]);
  // At double speed the same media goes by in half the frames.
  const fast = video({ startFrame: 0, endFrame: 150, trimStart: 15, speed: 2 });
  assert.deepEqual(sceneCutFrames(fast, [2_000_000, 4_000_000], fps), [15, 45]);
  // A cut between two frames splits at the first frame showing the new shot.
  assert.deepEqual(sceneCutFrames(video({ startFrame: 0, endFrame: 300 }), [1_016_667, 1_016_667], fps), [31]);
  // The range the engine reads.
  assert.deepEqual(analysisRange(clip, fps), [1, 10]);
  assert.deepEqual(analysisRange(video({ freeze: { at: 2.5 } } as Partial<VideoClipProps>), fps), [2.5, 1 / 30]);
});
