// After `cropui reopen`: the crop left on the clip (Rotation 10°) is read back from the project's
// file, the Crop dialog opens on it, and the engine draws the same straightened cut as FFmpeg's
// picture of it.
import { rulerMap, seek } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { compareFrame, expectedPicture, sourcePicture } from "./_crop.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const d = await savedProject(win, udDir);
  const clip = d.timeline.clips.filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick)[0];
  const c = clip.transform?.crop;
  check("the saved clip has the crop and its rotation", !!c && c.rotation === 10 && c.width < 1 && c.height < 1, JSON.stringify(c));
  const src = sourcePicture(ctx, 0);
  await seek(win, map, 0);
  await win.waitForTimeout(1500);
  const fw = await win.evaluate(() => document.getElementById("openrip-engine-frame").width);
  const fh = await win.evaluate(() => document.getElementById("openrip-engine-frame").height);
  const r = await compareFrame(ctx, expectedPicture(ctx, src, c, fw, fh, "reopened"));
  check("after reopening, the engine draws the straightened cut", r.mean < 10, `mean difference ${r.mean.toFixed(2)}`);
  await shot("c05-reopened");
  return report();
};
