// Beat markers on an audio clip (after `import timeline newtext` on a clip with sound, e.g.
// IMG_9079 with CLIP_NAME; OPENRIP_ENGINE_MUTE=1). The video's sound goes on an audio track from
// the left panel's Audio › Extracted, then:
// - the toolbar's Mark beat puts a beat at the playhead (a dot drawn on the clip, saved in its
//   media time, one undo step) and takes it off again;
// - the text dragged so its end comes 3 px from the beat lands on it (not with snapping off);
// - Auto beat from the toolbar's menu (Beat 2: every beat the engine finds, drawn) and from the
//   clip's menu (Auto mark beats › Beat 1: bar starts only, fewer); Clear beats.
import { rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { clipsOn, fpsOf, key, rowY } from "./_timeline.mjs";

/** How many beat dots the timeline draws (react-konva registers Konva on the window). */
export const markerCount = (win) =>
  win.evaluate(() => (window.Konva?.stages ?? []).flatMap((s) => s.find(".beat-markers")).reduce((n, g) => n + g.getChildren().length, 0));

/** The video's sound on its own track at the playhead, from Audio › Extracted. */
export const addExtracted = async (win) => {
  await win.locator("[data-testid=assets-tab-audio]").click();
  await win.locator("[data-testid=assets-section-extracted]").click();
  await win.waitForTimeout(1500);
  await settled(win, () => win.locator("[data-testid=audio-section-extracted] [data-testid=audio-row-add]").first().click());
};

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  await seek(win, map, 0);
  await addExtracted(win);
  let doc = await savedProject(win, ctx.udDir);
  const fps = fpsOf(doc);
  const sound = doc.timeline.clips.find((c) => c.type === "audio");
  check("Extracted's + puts the video's sound on an audio track", !!sound && /#audio$/.test(doc.assets[sound.assetId]?.path ?? ""));
  const saved = async () => (await savedProject(win, ctx.udDir)).timeline.clips.find((c) => c.clipId === sound.clipId);
  const beatButton = win.locator("[data-testid=tool-beat]");
  /** The playhead at `s`, the sound selected (seeking drops the selection). */
  const at = async (s) => {
    await seek(win, map, s);
    await select(ctx, doc, sound.clipId, s < 6 ? 9 : 3);
  };

  // ---- Mark beat ----
  await at(5);
  check("Mark beat is on with the sound selected under the playhead", (await beatButton.getAttribute("data-state")) === "add");
  await undoCase(ctx, check, "mark beat", () => settled(win, () => beatButton.click()), { frame: false });
  let c = await saved();
  check(`the beat is saved in media time (${JSON.stringify(c.beats)})`, c.beats?.manual?.length === 1 && Math.abs(c.beats.manual[0] - 5) < 0.5 / fps);
  await win.waitForTimeout(300);
  check(`a dot drawn on the clip (${await markerCount(win)})`, (await markerCount(win)) === 1);
  check("the button now takes it off", (await beatButton.getAttribute("data-state")) === "remove");
  await shot("bt-1-marked");

  // ---- snapping to it ----
  const textOf = (d) => clipsOn(d, d.timeline.tracks.find((t) => t.type === "text").timelineId)[0];
  const dragTextEndTo = async (s, px) => {
    const d = await savedProject(win, ctx.udDir);
    const t = textOf(d);
    const y = await rowY(ctx, d, t.timelineId);
    const [a, e] = [+t.startTick / 1e6, +t.endTick / 1e6];
    const x0 = map.x((a + e) / 2);
    const x1 = x0 + map.x(s) - map.x(e) + px;
    await settled(win, async () => {
      await win.mouse.move(x0, y);
      await win.mouse.down();
      await win.mouse.move((x0 + x1) / 2, y, { steps: 8 });
      await win.mouse.move(x1, y, { steps: 8 });
      await win.waitForTimeout(200);
      await win.mouse.up();
    });
    const after = textOf(await savedProject(win, ctx.udDir));
    return +after.endTick / 1e6;
  };
  await seek(win, map, 9);
  await key(win, "n");
  const loose = await dragTextEndTo(5, 3);
  await key(win, "n");
  await key(win, "Meta+z");
  const snapped = await dragTextEndTo(5, 3);
  check(`the text's end snaps to the beat (${snapped.toFixed(3)} s; ${loose.toFixed(3)} s with snapping off)`, Math.abs(snapped - 5) < 0.5 / fps && Math.abs(loose - 5) > 0.5 / fps);
  await key(win, "Meta+z");

  // Off again at the playhead.
  doc = await savedProject(win, ctx.udDir);
  await at(5);
  await settled(win, () => beatButton.click());
  check("Mark beat on the beat takes it off", ((await saved()).beats?.manual ?? []).length === 0 && (await markerCount(win)) === 0);

  // ---- Auto beat ----
  await at(5);
  await win.locator("[data-testid=tool-beat-menu]").click();
  await win.waitForTimeout(300);
  await undoCase(ctx, check, "auto beat", () => settled(win, () => win.locator("[data-testid=auto-beat-beat2]").click()), { frame: false });
  c = await saved();
  let every = 0;
  for (let i = 0; i < 40 && !(every = await markerCount(win)); i++) await win.waitForTimeout(250);
  check(`Beat 2: every beat the engine finds, drawn (${every} dots, ${JSON.stringify(c.beats)})`, c.beats?.auto === true && c.beats.everyBeat === true && every >= 4);
  await shot("bt-2-beat2");
  // The clip's menu: Auto mark beats › Beat 1.
  const [bx, by] = [map.x(3), await rowY(ctx, doc, sound.timelineId)];
  await win.mouse.click(bx, by, { button: "right" });
  await win.waitForTimeout(400);
  await win.locator("[data-menu-item=auto-beats]").hover();
  await win.waitForTimeout(300);
  await shot("bt-3-menu");
  await settled(win, () => win.locator("[data-menu-item=auto-beat1]").click());
  c = await saved();
  await win.waitForTimeout(300);
  const bars = await markerCount(win);
  check(`Beat 1 from the clip's menu: bar starts only (${bars} dots against ${every})`, c.beats?.auto === true && c.beats.everyBeat === false && bars > 0 && bars < every);
  await win.locator("[data-testid=tool-beat-menu]").click();
  await win.waitForTimeout(300);
  await settled(win, () => win.locator("[data-testid=clear-beats]").click());
  c = await saved();
  check("Clear beats: none left", !c.beats?.auto && !(c.beats?.manual?.length) && (await markerCount(win)) === 0);
  return report();
};
