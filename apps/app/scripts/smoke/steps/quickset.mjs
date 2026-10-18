// A change in the tab with nothing after it (after newtext): Typewriter on the text, or with
// QUICK=video Fade In on the video (its row found from the project), then the app is closed a
// second and a half later: the project file must have it by then. quickcheck, after a restart,
// finds it too.
import { rulerMap, tab } from "./_preview.mjs";
import { checks, choose, rowOf, savedClips } from "./_anim.mjs";

export const QUICK = process.env.QUICK === "video"
  ? { type: "video", label: "In", value: "Fade In" }
  : { type: "text", label: "Animation", value: "Typewriter" };

export default async (ctx) => {
  const { win } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  // Let the save the playhead's moves set off land first.
  await win.waitForTimeout(2000);
  await win.mouse.click(map.x(1.5), await rowOf(ctx, QUICK.type));
  await win.waitForTimeout(600);
  await tab(win, "Animation");
  await choose(win, QUICK.label, QUICK.value);
  const clips = await savedClips(win, ctx.udDir);
  const saved = clips.some((c) => c.animationIn?.name === QUICK.value);
  const { check, report } = checks();
  check(`${QUICK.value} in the project file 1.5 s later`, saved);
  return report();
};
