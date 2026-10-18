// The magnetic main track, ripple delete and Delete left / right (after import timeline: the
// clip alone on the main track from 0). Split by ⌘B with nothing selected (the main track's
// clip) at 3 s and 7 s into A, B and C; then each edit undone and redone (undoCase: the
// engine's frame and the saved project come back exactly):
//   ripple    B deleted: C closes up to 3 s
//   magnet    the toolbar's Main track magnet off, B deleted: the gap stays; then on again
//   q / w     Delete left at 1 s (A starts at what was 1 s, the track closes up, the playhead
//             goes to 0), Delete right at 1 s (B moves up to 1 s)
//   insert    C dragged before A: the track goes C A B, end to end
//   moveout   A dragged above the track onto a new one: the main track closes up
import { now, rulerMap, seek, timelineRect } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { button, doc, dragClip, fpsOf, isOn, key, layout, mainClips, mainTrack, packed, sec } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  // The playhead to s seconds; clicking the ruler drops the selection too.
  const at = (s) => seek(win, map, s);

  // ⌘B with nothing selected cuts the main track's clip.
  await at(3);
  await undoCase(ctx, check, "split at 3 s (⌘B, the main track's clip)", () => key(win, "Meta+b"), { frame: false });
  await at(7);
  await key(win, "Meta+b");
  let d = await doc(ctx);
  const [A, B, C] = mainClips(d);
  check("⌘B cut the main track into three", mainClips(d).length === 3 && packed(mainClips(d)), layout(mainClips(d)));
  const total = C.e;
  const f = fpsOf(d);

  // Ripple delete: B goes and C closes up.
  await at(4);
  const r = await undoCase(ctx, check, "ripple delete", async () => {
    await select(ctx, d, B.clipId, 5);
    await key(win, "Backspace");
  });
  d = await doc(ctx);
  let main = mainClips(d);
  check(
    "ripple delete closes the gap on the main track",
    r.ok && main.length === 2 && packed(main) && main[1].clipId === C.clipId && main[1].e === total - (B.e - B.s),
    layout(main),
  );
  await key(win, "Meta+z");

  // Magnet off: a delete leaves its gap. The toggle is a step too.
  await undoCase(ctx, check, "magnet toggle", () => button(win, "Main track magnet").click().then(() => win.waitForTimeout(600)), { frame: false });
  check("the toolbar's magnet is off, and saved off", !(await isOn(win, "Main track magnet")) && (await doc(ctx)).settings.mainTrackMagnet === false);
  d = await doc(ctx);
  await select(ctx, d, B.clipId, 5);
  await key(win, "Backspace");
  main = mainClips(await doc(ctx));
  check("with the magnet off, a delete leaves its gap", main.length === 2 && main[1].s === C.s, layout(main));
  await key(win, "Meta+z");
  await button(win, "Main track magnet").click();
  await win.waitForTimeout(600);
  check("the magnet is on again", (await isOn(win, "Main track magnet")) && (await doc(ctx)).settings.mainTrackMagnet === true);

  // Delete left at 1 s: what's left of A starts the track; the playhead goes to 0.
  await at(1);
  await undoCase(ctx, check, "delete left (Q)", () => key(win, "q"), { frame: false });
  main = mainClips(await doc(ctx));
  check("Q trims A to the playhead and the track closes up", packed(main) && main[0].e === A.e - f && main.length === 3, layout(main));
  check("after Q the playhead is at A's new start", (await now(win)) === 0, `at ${await now(win)} s`);

  // Delete right at 1 s: A ends there, B moves up.
  await at(1);
  const before = mainClips(await doc(ctx));
  await undoCase(ctx, check, "delete right (W)", () => key(win, "w"));
  main = mainClips(await doc(ctx));
  check("W trims A to the playhead and B moves up", packed(main) && main[0].e === f && main[1].s === f && main[1].e - main[1].s === before[1].e - before[1].s, layout(main));

  // Insert: C dragged to the start goes in before A, the rest making room.
  d = await doc(ctx);
  main = mainClips(d);
  const last = main[main.length - 1];
  await at(0.5);
  const ins = await undoCase(ctx, check, "insert on the main track", () =>
    dragClip(ctx, d, last, sec(d, (last.s + last.e) / 2), 0.1),
  );
  main = mainClips(await doc(ctx));
  check("C dragged to the start goes first, end to end", ins.ok && main[0].clipId === last.clipId && packed(main) && main.length === 3, layout(main));

  // Move out: the second clip dragged above the track (a new track): the main track closes up.
  d = await doc(ctx);
  main = mainClips(d);
  const second = main[1];
  const tl = await timelineRect(win);
  const mt = mainTrack(d);
  await at(sec(d, second.s) + 0.3);
  const out = await undoCase(ctx, check, "move off the main track", () =>
    dragClip(ctx, d, second, sec(d, (second.s + second.e) / 2), sec(d, (second.s + second.e) / 2), tl.y + mt.timelineY + 21),
  );
  d = await doc(ctx);
  main = mainClips(d);
  check(
    "a clip dragged off the main track leaves it closed up",
    out.ok && d.timeline.tracks.length === 2 && main.length === 2 && packed(main) && !main.some((c) => c.clipId === second.clipId),
    `${d.timeline.tracks.length} tracks; main ${layout(main)}`,
  );
  await ctx.shot("tl-magnet");
  return report();
};
