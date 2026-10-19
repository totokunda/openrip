// A text clip on the app's own project (after import timeline): the playhead to 0, the Text
// tool, a box dragged across the middle of the picture, then back to the pointer. The clip
// runs 0–3 s on a new track at the top. Leaves the ruler's mapping on ctx.map.
import { drag, now, previewRect, rulerMap, settled, pointerTool } from "./_preview.mjs";
export default async (ctx) => {
  const { win, shot } = ctx;
  ctx.map = await rulerMap(win);
  await win.mouse.click(ctx.map.x(0) - 4, ctx.map.y);
  await win.waitForTimeout(500);
  const at = await now(win);
  if (at !== 0) throw new Error(`playhead at ${at}, not 0`);
  // The picture sits in the middle of the stage; a portrait one is about 250 px wide.
  const p = await previewRect(win);
  const f = { x: p.x + p.w / 2 - 100, y: p.y + p.h / 2 - 30, w: 200, h: 60 };
  await win.keyboard.press("t");
  await settled(win, () => drag(win, f.x, f.y, f.x + f.w, f.y + f.h));
  await win.keyboard.press("Escape");
  await pointerTool(win);
  await win.waitForTimeout(500);
  await shot("n1-text");
  return `text box at ${JSON.stringify(f)}; ruler ${ctx.map.pps.toFixed(1)} px/s`;
};
