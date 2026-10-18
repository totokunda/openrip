// Timeline edits on a CapCut draft's converted clips (after capcut, TL_DRAFT: two clips or
// more on its main track). The draft's main track magnet comes from its config; then, each
// undone and redone with the engine's frame compared:
//   ripple    the first main clip deleted: the next closes up to 0, the engine draws it there
//   q         Delete left half a second into the second clip
//   insert    the last main clip dragged before the first
//   detach    the first clip's audio extracted: the engine's picture doesn't change
import { engineFrame, rulerMap, seek } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { button, doc, dragClip, isOn, key, layout, mainClips, packed, sec } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map = await rulerMap(win);
  const map = ctx.map;
  let d = await doc(ctx);
  check(
    "the draft's main track magnet comes from its config",
    typeof d.settings.mainTrackMagnet === "boolean" && (await isOn(win, "Main track magnet")) === d.settings.mainTrackMagnet,
    `saved ${d.settings.mainTrackMagnet}`,
  );
  if (!(await isOn(win, "Main track magnet"))) {
    await button(win, "Main track magnet").click();
    await win.waitForTimeout(500);
  }
  d = await doc(ctx);
  let main = mainClips(d);
  if (main.length < 2) throw new Error(`the draft has ${main.length} clips on its main track`);
  const lit = async () => (await engineFrame(win, "r + g + b > 60")).count;

  // Ripple delete of the first clip.
  await seek(win, map, 0.5);
  const first = main[0];
  const r = await undoCase(ctx, check, "ripple delete (draft)", async () => {
    await select(ctx, d, first.clipId, sec(d, (first.s + first.e) / 2));
    await key(win, "Backspace");
  });
  let after = mainClips(await doc(ctx));
  check("the next clip closes up to 0", r.ok && after[0].clipId === main[1].clipId && packed(after), layout(after));
  await key(win, "Meta+z");

  // Delete left half a second into the second clip.
  const second = main[1];
  await seek(win, map, sec(d, second.s) + 0.5);
  const q = await undoCase(ctx, check, "delete left (draft)", () => key(win, "q"), { frame: false });
  after = mainClips(await doc(ctx));
  check("Q trims the second clip and the track closes up", q.ok && packed(after) && after[1].e - after[1].s === second.e - second.s - Math.round(0.5 * d.settings.fps), layout(after));
  check("the engine draws the trimmed clip", (await lit()) > 1000, `${await lit()} lit pixels`);

  // Insert: the last clip before the first.
  d = await doc(ctx);
  main = mainClips(d);
  const last = main.at(-1);
  await seek(win, map, 0.3);
  const ins = await undoCase(ctx, check, "insert (draft)", () => dragClip(ctx, d, last, sec(d, (last.s + last.e) / 2), 0.05));
  after = mainClips(await doc(ctx));
  check("the last clip dragged to the start goes first", ins.ok && after[0].clipId === last.clipId && packed(after), layout(after));
  check("the engine draws it there", (await lit()) > 1000, `${await lit()} lit pixels`);

  // Detach the first clip's audio: the picture stays.
  d = await doc(ctx);
  main = mainClips(d);
  await seek(win, map, sec(d, (main[0].s + main[0].e) / 2));
  const before = (await engineFrame(win)).sum;
  const det = await undoCase(ctx, check, "extract audio (draft)", async () => {
    await select(ctx, d, main[0].clipId, sec(d, main[0].s) + 0.2);
    await key(win, "Meta+Shift+s");
  }, { frame: false });
  check("a converted clip's detached video draws as before", det.ok && (await engineFrame(win)).sum === before);
  await ctx.shot("tl-capcut");
  return report();
};
