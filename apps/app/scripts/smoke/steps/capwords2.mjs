// Captions whose style the engine doesn't draw (after capcut on a draft with them): the tab
// opens and lists the draft's style; picking one of the engine's replaces it.
import { diff, grab, rulerMap, seek, tallTimeline } from "./_preview.mjs";
import { checks, choose, options, pick, savedClips, savedProject, selected } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, udDir, logs } = ctx;
  await tallTimeline(win);
  const map = (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const clip = doc.timeline.clips.find((c) => c.spokenWords && c.captionStyle === "");
  if (!clip) throw new Error("no caption with an undrawn style");
  const t = (+clip.startTick + +clip.endTick) / 2e6;
  await seek(win, map, t);
  await grab(win, "draft");
  const errors = logs.length;
  await pick(ctx, doc, clip.clipId);
  await shot("u1-tab");
  const crashed = logs.slice(errors).filter((l) => l.startsWith("[pageerror]"));
  check("the tab opens", (await selected(win, "Animation")) !== null && crashed.length === 0, crashed.join(" ").slice(0, 300));
  check("lists the draft's style", (await selected(win, "Words")) === "CapCut's style", await selected(win, "Words"));
  const opts = await options(win, "Words").catch((e) => [e.message]);
  check("offers the engine's styles and the draft's", opts.join() === "Whole text,Three words, spoken one highlighted,One word at a time,CapCut's style", opts.join());
  await choose(win, "Words", "One word at a time").catch(() => {});
  await seek(win, map, t);
  await grab(win, "one");
  const saved = (await savedClips(win, udDir)).find((c) => c.clipId === clip.clipId)?.captionStyle;
  check("replaced by one word at a time", saved === "caption_one_word" && (await diff(win, "draft", "one")).n > 0, `${saved}; changed ${(await diff(win, "draft", "one")).n}`);
  return report();
};
