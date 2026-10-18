// A draft's Blink transitions (after capcut on a draft with them, one 0.5 s long): its
// inspector shows Blink and the Transitions tab offers it; a duration change and a round trip
// through White Flash keep CapCut's image sequence; with every Blink removed, the project still
// has the sequence, so Blink is still offered. (Where the draft's media is missing the eyelid closes over black:
// blinkapp checks it's drawn.)
import { rulerMap, tallTimeline } from "./_preview.mjs";
import { addTransition, checks, deleteTransition, duration, pickTransition, savedClips, savedProject, select, setDuration, transitionName, transitionsOffered } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  await tallTimeline(win);
  ctx.map = await rulerMap(win);
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const blinks = doc.timeline.clips.filter((c) => c.transitionOut?.type === "blink").sort((a, b) => +a.startTick - +b.startTick);
  const c = blinks.find((b) => b.transitionOut.duration === 0.5);
  const resource = c.transitionOut.resource;
  const saved = async (id) => (await savedClips(win, udDir)).find((x) => x.clipId === id)?.transitionOut;
  await pickTransition(ctx, doc, c.clipId);
  await shot("b1-tab");
  check("shows Blink with 0.5 s", (await transitionName(win)) === "Blink" && (await duration(win))?.value === 0.5, `${await transitionName(win)} ${JSON.stringify(await duration(win))}`);
  check("offers Blink", (await transitionsOffered(win)).includes("Blink"));
  await pickTransition(ctx, doc, c.clipId);
  await setDuration(win, 0.4);
  let s = await saved(c.clipId);
  check("duration 0.4 s keeps the image sequence", s?.type === "blink" && s?.duration === 0.4 && s?.resource === resource, JSON.stringify(s));
  await pickTransition(ctx, doc, c.clipId);
  await addTransition(win, "White Flash");
  await pickTransition(ctx, doc, c.clipId);
  await addTransition(win, "Blink");
  s = await saved(c.clipId);
  check("White Flash and back to Blink keeps the image sequence", s?.type === "blink" && s?.resource === resource, JSON.stringify(s));
  for (const b of blinks) {
    await pickTransition(ctx, doc, b.clipId);
    await deleteTransition(win);
  }
  await shot("b2-removed");
  const left = (await savedClips(win, udDir)).filter((x) => x.transitionOut);
  check("all removed", left.length === 0, `${left.length} left: ${left.map((x) => `${x.clipId.slice(0, 8)} at ${+x.startTick / 1e6} s`).join(", ")}`);
  const opts = await transitionsOffered(win);
  check("Blink still offered from the draft's image sequence", opts.includes("Blink"), opts.join());
  if (opts.includes("Blink")) {
    await select(ctx, doc, c.clipId);
    await addTransition(win, "Blink");
    s = await saved(c.clipId);
    check("Blink again, with the image sequence", s?.type === "blink" && s?.resource === resource, JSON.stringify(s));
  }
  return report();
};
