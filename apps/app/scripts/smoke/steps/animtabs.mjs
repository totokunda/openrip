// Which clips get the Animation tab (after capcut on a draft with text, video, sound and
// effect bars): text, video and photos do; sound and the draft's effects and filters don't.
import { rulerMap, tallTimeline } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";

export default async (ctx) => {
  const { win, udDir } = ctx;
  await tallTimeline(win);
  ctx.map = await rulerMap(win);
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const tabs = () => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()));
  for (const type of ["text", "video", "image", "audio", "filter"]) {
    const clip = doc.timeline.clips.find((c) => c.type === type);
    if (!clip) continue;
    await select(ctx, doc, clip.clipId);
    const has = (await tabs()).includes("Animation");
    check(`${type}: ${["text", "video", "image"].includes(type) ? "has" : "no"} Animation tab`, has === ["text", "video", "image"].includes(type), (await tabs()).join(", "));
  }
  return report();
};
