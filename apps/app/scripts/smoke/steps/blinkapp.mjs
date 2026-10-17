// Blink on the app's own clips (after capcut on a draft with Blink, whose media needn't be on
// this machine; run with the standard clip): a draft clip with Blink is copied into a new
// project with the standard clip split at 5 s. Now that the project has CapCut's image
// sequence, Blink is offered for the app's clips, and the eyelid closes over the video up to
// the cut.
import { diff, grab, rulerMap, seek, settled, tallTimeline } from "./_preview.mjs";
import { bar, checks, choose, options, pick, savedClips, savedProject } from "./_anim.mjs";
import importMedia from "./import.mjs";
import toTimeline from "./timeline.mjs";
import { SPLIT } from "./textcut.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  await tallTimeline(win);
  ctx.map = await rulerMap(win);
  let doc = await savedProject(win, udDir);
  const blink = doc.timeline.clips.find((c) => c.transitionOut?.type === "blink");
  await pick(ctx, doc, blink.clipId);
  await win.keyboard.press("Meta+c");
  await win.getByText("Projects", { exact: true }).first().click();
  await win.waitForTimeout(600);
  await win.getByText("New Project", { exact: true }).click();
  await win.waitForTimeout(3000);
  await importMedia(ctx);
  await toTimeline(ctx);
  const map = (ctx.map = await rulerMap(win));
  doc = await savedProject(win, udDir);
  const video = doc.timeline.clips.find((c) => c.type === "video");
  // Without the image sequence: no Blink.
  await pick(ctx, doc, video.clipId);
  check("no Blink before", !(await options(win, "Transition")).includes("Blink"));
  // The draft's clip pasted after the standard clip, then the standard clip split at 5 s.
  await seek(win, map, 11);
  await settled(win, () => win.keyboard.press("Meta+v"));
  await seek(win, map, 5);
  await win.mouse.click(...(await bar(ctx, doc, video.clipId, 2)));
  await win.waitForTimeout(600);
  await settled(win, () => win.mouse.click(...SPLIT));
  // Two thirds of the way to the cut in a 0.5 s Blink (frame 118 at 24 fps): the lids show.
  await seek(win, map, 118 / 24);
  await grab(win, "none");
  await seek(win, map, 5);
  await grab(win, "none@cut");
  doc = await savedProject(win, udDir);
  const first = doc.timeline.clips.filter((c) => c.type === "video" && c.assetId === video.assetId).sort((a, b) => +a.startTick - +b.startTick)[0];
  await pick(ctx, doc, first.clipId);
  const opts = await options(win, "Transition");
  check("Blink offered once the project has its image sequence", opts.includes("Blink"), opts.join());
  if (opts.includes("Blink")) await choose(win, "Transition", "Blink");
  const saved = (await savedClips(win, udDir)).find((c) => c.clipId === first.clipId)?.transitionOut;
  check("saved with the image sequence", saved?.type === "blink" && saved?.resource === blink.transitionOut.resource, JSON.stringify(saved));
  await seek(win, map, 118 / 24);
  await grab(win, "closing");
  await seek(win, map, 5);
  await grab(win, "closed");
  await shot("bl1-closed");
  const [closing, closed, open] = [await diff(win, "none", "closing"), await diff(win, "none@cut", "closed"), await diff(win, "closing", "none")];
  check("the eyelid closes over the video up to the cut", open.light > 0.1 && closing.n > 0 && closed.light < 0.05, `light without it ${open.light.toFixed(2)}; changed ${closing.n}; light at the cut ${closed.light.toFixed(2)}`);
  return report();
};
