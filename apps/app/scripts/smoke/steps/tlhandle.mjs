// A click on a clip's trim handles changes nothing (after import timeline newtext): the text
// selected, its left and then right handle pressed and released without moving. The saved
// project stays as it was (the clips in the same order), and ⌘Z still undoes the edit before
// (the text added), not an invisible step the click made.
import { rulerMap, seek, settled } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { docOf } from "./_undo.mjs";
import { clipsOn, doc, key, rowY, sec } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  await seek(win, map, 5);
  let d = await doc(ctx);
  const text = clipsOn(d, d.timeline.tracks.find((t) => t.type === "text").timelineId)[0];
  await select(ctx, d, text.clipId);
  const before = docOf(await doc(ctx));
  const y = await rowY(ctx, d, text.timelineId);
  for (const x of [map.x(sec(d, text.s)) + 1, map.x(sec(d, text.e)) - 1]) {
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.up();
    await win.waitForTimeout(400);
  }
  d = await doc(ctx);
  check("pressing the trim handles leaves the project as it was", docOf(d) === before);
  await key(win, "Meta+z");
  d = await doc(ctx);
  check("⌘Z after it undoes the edit before (the text added)", !d.timeline.clips.some((c) => c.type === "text"), `${d.timeline.clips.length} clips`);
  await settled(win, () => win.keyboard.press("Meta+Shift+z"), { timeout: 2000 });
  return report();
};
