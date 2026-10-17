// Select a caption bar on the timeline (CAPTION_AT="x,y" in CSS px, measured from a screenshot;
// screenshots are at 2x) and open its Text tab.
import { tab } from "./_preview.mjs";
export default async ({ win, shot }) => {
  await win.keyboard.press("v");
  const [x, y] = (process.env.CAPTION_AT || "185,778").split(",").map(Number);
  await win.mouse.click(x, y);
  await win.waitForTimeout(800);
  await tab(win, "Text");
  await shot("t1-text-tab");
  return "Text tab open";
};
