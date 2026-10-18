// A draft's In animation the engine doesn't draw (after capcut on a draft with one): the tab
// lists it by name with the note and no duration; a trim keeps it; another animation replaces
// it, after which it's no longer offered.
import { diff, drag, grab, rulerMap, seek, settled } from "./_preview.mjs";
import { bar, checks, choose, duration, note, options, pick, savedClips, savedProject, selected } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const clip = doc.timeline.clips.find((c) => c.type === "text" && c.animationIn?.type === "");
  if (!clip) throw new Error("no undrawn In animation");
  // Its card's label: CapCut's name for it, or "CapCut's" when the draft has none.
  const label = `${clip.animationIn.name || "CapCut's"} (CapCut)`;
  const [start, end] = [+clip.startTick / 1e6, +clip.endTick / 1e6];
  await pick(ctx, doc, clip.clipId);
  await shot("k1-tab");
  check("listed by name with the note, no duration", (await selected(win, "Animation")) === label && /doesn't draw/.test(await note(win)) && (await duration(win)) === null, `${await selected(win, "Animation")} | ${await note(win)}`);
  const opts = await options(win, "Animation");
  check("a card of its own after None, then the engine's", opts.join() === `None,${label},Type 1,Type 2,Typewriter,Fade In,Zoom In,Zoom Out,Slide`, opts.join());
  // Trim its end by a fifth.
  const [x, y] = await bar(ctx, doc, clip.clipId, end);
  await settled(win, () => drag(win, x - 1, y, map.x(end - (end - start) / 5), y));
  let saved = (await savedClips(win, udDir)).find((c) => c.clipId === clip.clipId);
  check("kept through a trim", +saved.endTick < +clip.endTick && JSON.stringify(saved.animationIn) === JSON.stringify(clip.animationIn), `${saved.endTick}: ${JSON.stringify(saved.animationIn)}`);
  await pick(ctx, doc, clip.clipId);
  check("still listed after the trim", (await selected(win, "Animation")) === label, await selected(win, "Animation"));
  // Replaced by Type 1: typing a quarter of the way in.
  const quarter = start + (end - start) / 4;
  await seek(win, map, quarter);
  await grab(win, "keep");
  await pick(ctx, doc, clip.clipId);
  await choose(win, "Animation", "Type 1");
  await seek(win, map, quarter);
  await grab(win, "type1");
  saved = (await savedClips(win, udDir)).find((c) => c.clipId === clip.clipId);
  const changed = (await diff(win, "keep", "type1")).n;
  check("replaced by Type 1", saved.animationIn?.type === "type_1" && changed > 0, `${JSON.stringify(saved.animationIn)}; changed ${changed}`);
  await pick(ctx, doc, clip.clipId);
  const after = await options(win, "Animation");
  check("no longer offered once replaced", after.join() === "None,Type 1,Type 2,Typewriter,Fade In,Zoom In,Zoom Out,Slide", after.join());
  return report();
};
