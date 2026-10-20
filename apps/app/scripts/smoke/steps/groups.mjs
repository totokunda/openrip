// Group (⌘G) as CapCut's: clips stuck together, each staying on its own track (after `import
// timeline newtext`: the 10 s clip with a text 0-3 s over it; OPENRIP_ENGINE_MUTE=1). A second
// text is made at 5 s, then:
// - ⌘G on the two texts: they share a group id in the saved project, hidden stays off, each
//   keeps its track, one undo step takes it back;
// - clicking one of them selects both (every bar outlined, as the shot shows);
// - dragging one 1 s along moves both, undone in one step;
// - ⌘C ⌘V pastes a group of its own (two new clips with a new group id);
// - V deactivates both; Delete removes both and undo brings both back;
// - ⌘⇧G takes the group apart;
// - a group of the video and the text 0-3 s is split at 1.5 s: the left halves stick together
//   and the right halves, as two groups;
// - the project saved with a group opens with it (the groups on the clips as saved).
import { drag, now, previewRect, rulerMap, seek, settled, pointerTool } from "./_preview.mjs";
import { bar, checks, savedProject } from "./_anim.mjs";
import { rowY } from "./_timeline.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const doc = async () => {
    await win.waitForTimeout(1800);
    return savedProject(win, udDir);
  };
  const clipsOf = (d, type) => d.timeline.clips.filter((c) => c.type === type).sort((a, b) => +a.startTick - +b.startTick);
  const press = async (keys) => {
    await win.evaluate(() => document.activeElement?.blur?.());
    await settled(win, () => win.keyboard.press(keys), { timeout: 2500 });
  };
  const select = async (d, picks) => {
    await win.keyboard.press("Escape");
    for (let i = 0; i < picks.length; i++) {
      const [id, at] = picks[i];
      const [x, y] = await bar(ctx, d, id, at);
      if (i) await win.keyboard.down("Shift");
      await win.mouse.click(x, y);
      if (i) await win.keyboard.up("Shift");
      await win.waitForTimeout(400);
    }
    // The first click after a menu or a shortcut can be taken by the focus: click the last bar again.
    if (picks.length === 1) {
      const [x, y] = await bar(ctx, d, picks[0][0], picks[0][1]);
      await win.mouse.click(x + 2, y);
      await win.waitForTimeout(400);
    }
  };

  // A second text, at 5 s.
  await seek(win, ctx.map, 5);
  const p = await previewRect(win);
  await win.keyboard.press("t");
  await settled(win, () => drag(win, p.x + p.w / 2 - 100, p.y + p.h / 2 + 60, p.x + p.w / 2 + 100, p.y + p.h / 2 + 120));
  await win.keyboard.press("Escape");
  await pointerTool(win);
  await win.waitForTimeout(500);
  let d = await doc();
  const texts = clipsOf(d, "text");
  if (texts.length !== 2) throw new Error(`${texts.length} texts, not 2`);
  const [t1, t2] = texts;
  const video = clipsOf(d, "video")[0];
  
  // Group the two texts.
  await select(d, [[t1.clipId, 1], [t2.clipId, 6]]);
  await press("Meta+g");
  d = await doc();
  const g1 = clipsOf(d, "text");
  check("Group sticks the two texts together under one id", !!g1[0].bundleId && g1[0].bundleId === g1[1].bundleId, `${g1[0].bundleId} / ${g1[1].bundleId}`);
  check("each stays on its own track, visible, drawn as usual", g1[0].timelineId === t1.timelineId && g1[1].timelineId === t2.timelineId && g1[0].timelineId !== g1[1].timelineId && !g1.some((c) => c.hidden) && !d.timeline.clips.some((c) => c.type === "group"), `${g1.map((c) => c.timelineId.slice(0, 4))}`);
  await shot("g1-grouped");

  // One undo step takes it back; redo puts it back.
  await press("Meta+z");
  d = await doc();
  check("one undo takes the group back", clipsOf(d, "text").every((c) => !c.bundleId));
  await press("Meta+Shift+z");
  d = await doc();
  check("redo makes it again", clipsOf(d, "text").every((c) => !!c.bundleId));

  // Clicking one selects both.
  await win.keyboard.press("Escape");
  const [bx, by] = await bar(ctx, d, t1.clipId, 1);
  await win.mouse.click(bx, by);
  await win.waitForTimeout(800);
  await shot("g2-selected");
  await win.mouse.click(bx + 3, by);
  await win.waitForTimeout(800);
  await shot("g2b-selected");

  // Dragging one moves both, in one step.
  const start = (c) => Math.round(+c.startTick / 1e5) / 10;
  const before = clipsOf(d, "text").map(start);
  await settled(win, () => drag(win, ctx.map.x(1), by, ctx.map.x(2), by));
  d = await doc();
  const moved = clipsOf(d, "text").map(start);
  check("dragging one clip 1 s along moves both", Math.abs(moved[0] - before[0] - 1) < 0.15 && Math.abs(moved[1] - before[1] - 1) < 0.15, `${before} -> ${moved}`);
  await press("Meta+z");
  d = await doc();
  check("one undo puts both back", clipsOf(d, "text").map(start).every((v, i) => Math.abs(v - before[i]) < 0.05), clipsOf(d, "text").map(start).join(","));

  // Copy and paste: a group of its own.
  await seek(win, ctx.map, 9);
  await select(d, [[t1.clipId, 1]]);
  await press("Meta+c");
  await seek(win, ctx.map, 9);
  await press("Meta+v");
  d = await doc();
  const all = clipsOf(d, "text");
  const bundles = [...new Set(all.map((c) => c.bundleId))];
  check("paste makes two more clips as a group of their own", all.length === 4 && bundles.length === 2 && bundles.every((b) => b && all.filter((c) => c.bundleId === b).length === 2), `${all.length} texts, ${bundles.length} groups`);
  await press("Meta+z");
  d = await doc();
  check("one undo takes the paste back", clipsOf(d, "text").length === 2);

  // Deactivate and delete act on the group.
  await select(d, [[t2.clipId, 6]]);
  const deactivate = async (id, at) => {
    d = await doc();
    const [x, y] = await bar(ctx, d, id, at);
    await win.mouse.click(x, y, { button: "right" });
    await win.waitForTimeout(400);
    await settled(win, () => win.locator("[data-testid=menu-deactivate]").click());
  };
  await deactivate(t2.clipId, 6);
  d = await doc();
  check("Deactivate clip deactivates the whole group", clipsOf(d, "text").every((c) => c.deactivated === true), clipsOf(d, "text").map((c) => c.deactivated).join(","));
  await deactivate(t2.clipId, 6);
  await select(d, [[t2.clipId, 6]]);
  await shot("g3-before-delete");
  await press("Backspace");
  d = await doc();
  check("Delete removes the whole group", clipsOf(d, "text").length === 0, `${clipsOf(d, "text").length} left`);
  await press("Meta+z");
  d = await doc();
  check("one undo brings the whole group back, still grouped", clipsOf(d, "text").length === 2 && clipsOf(d, "text")[0].bundleId === clipsOf(d, "text")[1].bundleId && !!clipsOf(d, "text")[0].bundleId);

  // Ungroup.
  await select(d, [[t2.clipId, 6]]);
  await press("Meta+Shift+g");
  d = await doc();
  check("⌘⇧G takes the group apart", clipsOf(d, "text").every((c) => !c.bundleId));
  await press("Meta+z");

  // Group the video and the text at 0-3 s, split at 1.5 s.
  d = await doc();
  await press("Meta+Shift+g");
  d = await doc();
  await select(d, [[video.clipId, 8], [t1.clipId, 1]]);
  await press("Meta+g");
  d = await doc();
  const vt = [clipsOf(d, "video")[0], clipsOf(d, "text")[0]];
  check("a video and a text can be grouped too", !!vt[0].bundleId && vt[0].bundleId === vt[1].bundleId);
  await seek(win, ctx.map, 1.5);
  await press("Meta+b");
  d = await doc();
  const vs = clipsOf(d, "video");
  const ts = clipsOf(d, "text").filter((c) => +c.startTick < 3e6);
  check("split at the playhead cuts both clips of the group", vs.length === 2 && ts.length === 2, `${vs.length} videos, ${ts.length} texts`);
  check("the left halves stick together, and the right halves, as two groups", !!vs[0].bundleId && vs[0].bundleId === ts[0].bundleId && !!vs[1].bundleId && vs[1].bundleId === ts[1].bundleId && vs[0].bundleId !== vs[1].bundleId, `${vs.map((c) => c.bundleId?.slice(0, 4))} ${ts.map((c) => c.bundleId?.slice(0, 4))}`);
  await press("Meta+z");
  void now;
  void rowY;
  return report();
};
