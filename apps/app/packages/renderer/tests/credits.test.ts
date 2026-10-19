// Tests for src/lib/credits.ts and src/lib/template-merge.ts: `node --test tests/` in
// packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectCredits, creditLine, creditsSummary, creditsText, requiredCredits } from "../src/lib/credits.ts";
import { mergeTemplate } from "../src/lib/template-merge.ts";
import type { AssetCredit } from "../src/lib/types.ts";

const by: AssetCredit = {
  kind: "video",
  title: "Waterfall in Huascarán",
  author: "CorraleH",
  authorUrl: "https://commons.wikimedia.org/wiki/User:CorraleH",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  sourceName: "Wikimedia Commons",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Waterfall.webm",
  attributionRequired: true,
};
const cc0: AssetCredit = { kind: "photo", title: "Mountain", author: "A. Person", license: "CC0", sourceName: "Openverse", sourceUrl: "https://www.flickr.com/photos/1/2", attributionRequired: false };
const song: AssetCredit = { kind: "music", title: "Calm", author: "Some Band", license: "CC BY 4.0", sourceName: "Free Music Archive", attributionRequired: true };

test("a credit line names the work, author, licence and where it came from", () => {
  assert.equal(creditLine(by), '"Waterfall in Huascarán" by CorraleH, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via Wikimedia Commons: https://commons.wikimedia.org/wiki/File:Waterfall.webm');
  assert.equal(creditLine(cc0), '"Mountain" by A. Person, CC0, via Openverse: https://www.flickr.com/photos/1/2');
  assert.equal(creditLine({ ...song, author: undefined }), '"Calm", CC BY 4.0, via Free Music Archive');
});

test("credits are collected from the assets that carry one, each once", () => {
  const list = collectCredits({ a: { credit: by }, b: { credit: cc0 }, c: {}, d: { credit: { ...by } }, e: undefined });
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((c) => c.title), ["Waterfall in Huascarán", "Mountain"]);
  assert.deepEqual(collectCredits([{ credit: song }, {}]), [song]);
  assert.deepEqual(collectCredits({}), []);
});

test("only CC BY credits are required", () => {
  assert.deepEqual(requiredCredits([by, cc0, song]), [by, song]);
});

test("the credits text has a heading per kind and a line each; only the required ones on request", () => {
  const list = [cc0, song, by];
  assert.equal(
    creditsText(list),
    ["Videos:", `- ${creditLine(by)}`, "", "Photos:", `- ${creditLine(cc0)}`, "", "Music:", `- ${creditLine(song)}`].join("\n"),
  );
  assert.equal(creditsText(list, true), ["Videos:", `- ${creditLine(by)}`, "", "Music:", `- ${creditLine(song)}`].join("\n"));
  assert.equal(creditsText([cc0], true), "");
  assert.equal(creditsText([]), "");
});

test("the summary counts what needs credit", () => {
  assert.equal(creditsSummary([]), "No openly licensed assets in this project.");
  assert.equal(creditsSummary([cc0]), "1 openly licensed asset, none need credit.");
  assert.equal(creditsSummary([by, cc0, song]), "3 openly licensed assets, 2 need credit.");
  assert.equal(creditsSummary([by]), "1 openly licensed asset, 1 needs credit.");
});

const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};
const track = (timelineId: string, type: string) => ({ timelineId, type }) as never;
const clip = (clipId: string, timelineId: string, type: string, startFrame: number, endFrame: number, extra: object = {}) => ({ clipId, timelineId, type, startFrame, endFrame, ...extra }) as never;

test("merging a template: fresh ids, shifted to the playhead, its media reused when the project has it", () => {
  const project = {
    clips: [clip("p1", "pt", "video", 0, 100, { assetId: "pa" })],
    timelines: [track("pt", "media")],
    assets: { pa: { id: "pa", type: "video", path: "/m/a.mp4", duration: 4 } as never },
  };
  const tpl = {
    fps: 24,
    clips: [clip("t1", "tt", "video", 0, 48, { assetId: "ta", linkId: "L" }), clip("t2", "tx", "text", 10, 40), clip("t3", "ta1", "audio", 0, 48, { assetId: "tb", linkId: "L" })],
    tracks: [track("tt", "media"), track("tx", "text"), track("ta1", "audio")],
    assets: { ta: { id: "ta", type: "video", path: "/m/a.mp4", duration: 2 } as never, tb: { id: "tb", type: "audio", path: "/m/b.mp3", duration: 2 } as never },
  };
  const out = mergeTemplate(project, tpl, 30, 24, counter());
  assert.equal(out.clips.length, 4);
  const added = out.clips.slice(1) as any[];
  assert.deepEqual(added.map((c) => [c.startFrame, c.endFrame]), [[30, 78], [40, 70], [30, 78]]);
  assert.ok(added.every((c) => !["t1", "t2", "t3"].includes(c.clipId)));
  // The same file is the project's asset, not a second one; the new file is added.
  assert.equal(added[0].assetId, "pa");
  assert.equal(Object.keys(out.assets).length, 2);
  assert.equal(out.assets[added[2].assetId].path, "/m/b.mp3");
  // Linked clips stay linked to each other, and not to the template's id.
  assert.equal(added[0].linkId, added[2].linkId);
  assert.notEqual(added[0].linkId, "L");
  // Tracks: the template's (not audio) above the project's, its audio below.
  assert.deepEqual(out.timelines.map((t) => t.type), ["media", "text", "media", "audio"]);
  assert.equal(out.timelines[2].timelineId, "pt");
  assert.equal(added[1].timelineId, out.timelines[1].timelineId);
  assert.equal(out.ids.length, 3);
});

test("merging into an empty project takes the template's tracks as they are, and a different frame rate rescales the times", () => {
  const empty = { clips: [], timelines: [], assets: {} };
  const tpl = { fps: 30, clips: [clip("t1", "tt", "image", 0, 90)], tracks: [track("tt", "media")], assets: {} };
  const out = mergeTemplate(empty, tpl, 0, 24, counter());
  assert.equal(out.timelines.length, 1);
  assert.equal((out.clips[0] as any).endFrame, 72);
});

test("merging the same template twice makes two sets of clips", () => {
  const tpl = { fps: 24, clips: [clip("t1", "tt", "text", 0, 24)], tracks: [track("tt", "text")], assets: {} };
  const next = counter();
  const once = mergeTemplate({ clips: [], timelines: [], assets: {} }, tpl, 0, 24, next);
  const twice = mergeTemplate({ clips: once.clips, timelines: once.timelines, assets: once.assets }, tpl, 0, 24, next);
  assert.equal(twice.clips.length, 2);
  assert.equal(new Set(twice.clips.map((c: any) => c.clipId)).size, 2);
  assert.equal(twice.timelines.length, 2);
});
