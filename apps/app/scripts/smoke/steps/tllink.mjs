// A video and its extracted audio stay linked (after import timeline): ⇧⌘S detaches the
// clip's audio onto a track below, linked to the video; then, each undone and redone:
//   split     ⌘B at 5 s on the video cuts both, halves linked in pairs
//   trim      the second video's right edge dragged a second in: its audio's end follows
//   move      with the magnet off, the second video dragged a second later: its audio follows
//   delete    the second video deleted: its audio goes too
//   unlink    Unlink from the clip's menu; the video moved alone after it
// The engine's frame should show the video throughout (detached, its picture doesn't change).
import { drag, engineFrame, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { button, doc, dragClip, handleX, isOn, key, rowY, sec } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const byType = (d, type) => d.timeline.clips.filter((c) => c.type === type).map((c) => ({ ...c, s: Math.round((+c.startTick * d.settings.fps) / 1e6), e: Math.round((+c.endTick * d.settings.fps) / 1e6) })).sort((a, b) => a.s - b.s);

  await seek(win, map, 2);
  const lit = async () => (await engineFrame(win, "r + g + b > 120")).count;
  const before = await lit();
  let d = await doc(ctx);
  const video = byType(d, "video")[0];
  const detach = await undoCase(ctx, check, "extract audio (⇧⌘S)", async () => {
    await select(ctx, d, video.clipId, 2);
    await key(win, "Meta+Shift+s");
  }, { frame: false });
  d = await doc(ctx);
  let [v] = byType(d, "video");
  let [a] = byType(d, "audio");
  check("the audio is on its own track, linked to the video", detach.ok && !!a && !!v.linkId && v.linkId === a.linkId && a.s === v.s && a.e === v.e, `link ${v?.linkId} / ${a?.linkId}`);
  const after = await lit();
  check("the engine still draws the detached video", after > before * 0.9 && after > 1000, `${before} lit pixels before, ${after} after`);

  // Split: both cut, the halves linked in pairs.
  await seek(win, map, 5);
  await undoCase(ctx, check, "split linked", async () => {
    await select(ctx, d, v.clipId, 3);
    await key(win, "Meta+b");
  }, { frame: false });
  d = await doc(ctx);
  let vs = byType(d, "video");
  let as = byType(d, "audio");
  check(
    "⌘B cuts the video and its audio, the halves linked in pairs",
    vs.length === 2 && as.length === 2 && vs[0].linkId === as[0].linkId && vs[1].linkId === as[1].linkId && vs[0].linkId !== vs[1].linkId && as[1].s === vs[1].s,
    vs.map((c, i) => `${c.s}-${c.e}/${as[i]?.s}-${as[i]?.e}`).join(" "),
  );

  // Trim: the second video's right edge a second in; its audio's end follows.
  const fps = d.settings.fps;
  const endBefore = vs[1].e;
  await seek(win, map, 6);
  await undoCase(ctx, check, "trim linked", async () => {
    await select(ctx, d, vs[1].clipId, 7);
    const y = await rowY(ctx, d, vs[1].timelineId);
    const endS = sec(d, vs[1].e);
    const hx = await handleX(win, map.x(endS), y);
    await settled(win, () => drag(win, hx, y, map.x(endS - 1), y));
  }, { frame: false });
  d = await doc(ctx);
  vs = byType(d, "video");
  as = byType(d, "audio");
  check("a trimmed video's audio is trimmed with it", vs[1].e === as[1].e && vs[1].e <= endBefore - fps + 2, `video ${vs[1].s}-${vs[1].e}, audio ${as[1].s}-${as[1].e}`);

  // Move: with the magnet off the second video can go a second later; its audio follows.
  await button(win, "Main track magnet").click();
  await win.waitForTimeout(500);
  await seek(win, map, 9);
  const moved = await undoCase(ctx, check, "move linked", () => dragClip(ctx, d, vs[1], sec(d, vs[1].s) + 1.5, sec(d, vs[1].s) + 2.5));
  d = await doc(ctx);
  const [vs2, as2] = [byType(d, "video"), byType(d, "audio")];
  check("a moved video's audio moves with it", moved.ok && vs2[1].s === as2[1].s && vs2[1].s >= vs[1].s + fps - 2, `video ${vs[1].s} → ${vs2[1].s}, audio ${as[1].s} → ${as2[1].s}`);

  // Delete: its audio goes too.
  await seek(win, map, 2);
  await undoCase(ctx, check, "delete linked", async () => {
    await select(ctx, d, vs2[1].clipId);
    await key(win, "Backspace");
  }, { frame: false });
  d = await doc(ctx);
  check("deleting a video deletes its audio", byType(d, "video").length === 1 && byType(d, "audio").length === 1);
  await key(win, "Meta+z");

  // Linkage off (`): the video moves alone, and stays linked.
  await key(win, "`");
  check("` turns linkage off", !(await isOn(win, "Linkage")));
  d = await doc(ctx);
  const [v4, a4] = [byType(d, "video")[1], byType(d, "audio")[1]];
  await dragClip(ctx, d, v4, sec(d, v4.s) + 0.5, sec(d, v4.s) + 1.5);
  d = await doc(ctx);
  check(
    "with linkage off a linked video moves alone, still linked",
    byType(d, "video")[1].s !== v4.s && byType(d, "audio")[1].s === a4.s && byType(d, "video")[1].linkId === a4.linkId,
    `video ${v4.s} → ${byType(d, "video")[1].s}, audio ${a4.s} → ${byType(d, "audio")[1].s}`,
  );
  await key(win, "Meta+z");
  await key(win, "`");

  // Unlink, from the clip's menu; then the video moves alone.
  d = await doc(ctx);
  const [v3, a3] = [byType(d, "video")[1], byType(d, "audio")[1]];
  await undoCase(ctx, check, "unlink", async () => {
    const y = await rowY(ctx, d, v3.timelineId);
    await win.mouse.click(map.x(sec(d, v3.s) + 0.5), y, { button: "right" });
    await win.waitForTimeout(400);
    await settled(win, () => win.getByRole("button", { name: "Unlink", exact: true }).click(), { timeout: 1500 });
  }, { frame: false });
  d = await doc(ctx);
  check("Unlink takes the link off both", !byType(d, "video")[1].linkId && !byType(d, "audio")[1].linkId);
  await dragClip(ctx, d, v3, sec(d, v3.s) + 0.5, sec(d, v3.s) + 1.5);
  d = await doc(ctx);
  check("an unlinked video moves alone", byType(d, "video")[1].s !== v3.s && byType(d, "audio")[1].s === a3.s, `video ${v3.s} → ${byType(d, "video")[1].s}, audio ${a3.s} → ${byType(d, "audio")[1].s}`);
  await button(win, "Main track magnet").click();
  await ctx.shot("tl-link");
  return report();
};
