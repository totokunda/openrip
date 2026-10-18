// The app's own project with an animation and a transition (after import timeline newtext):
// Type 1 over 1 s on the text (0–3 s), the video split at 5 s with White Flash into its second
// half. For persist and animexport.
import { clickSplit, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { choose, rowOf, setDuration } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const ROW = await rowOf(ctx, "text");
  const video = await rowOf(ctx, "video");
  const select = async (x, y) => {
    await win.mouse.click(x, y);
    await win.waitForTimeout(600);
    await tab(win, "Animation");
  };
  await select(map.x(1.5), ROW);
  await choose(win, "Animation", "Type 1");
  await setDuration(win, 1);
  await seek(win, map, 5);
  await win.mouse.click(map.x(2), video);
  await win.waitForTimeout(600);
  await settled(win, () => clickSplit(win));
  await select(map.x(2), video);
  await choose(win, "Transition", "White Flash");
  await shot("s1-setup");
  return "Type 1 on the text, White Flash at 5 s";
};
