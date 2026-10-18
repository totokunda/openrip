// With a caption's Text tab open (selcaption): uppercase it, then make its stroke red (switched
// on first if the caption has none). Checks the engine's frame changes after each edit and red
// pixels appear.
import { engineFrame } from "./_preview.mjs";
import { textCase, textColor } from "./_undo.mjs";
const RED = "r > 170 && g < 90 && b < 90";
export default async ({ win, shot }) => {
  const before = await engineFrame(win, RED);
  await textCase(win, "uppercase");
  await win.waitForTimeout(500);
  const upper = await engineFrame(win, RED);
  await shot("t2-uppercase");
  // Stroke ▸ Color, through its well's picker.
  const on = win.locator("[data-testid=text-stroke-on]");
  if ((await on.getAttribute("aria-checked")) !== "true") await on.click();
  await textColor(win, "text-stroke-color", "ff0000");
  await win.waitForTimeout(500);
  const red = await engineFrame(win, RED);
  await shot("t3-red-stroke");
  return `red pixels ${before.count} → ${upper.count} → ${red.count}; frame changed on uppercase ${before.sum !== upper.sum}, on stroke ${upper.sum !== red.sum}`;
};
