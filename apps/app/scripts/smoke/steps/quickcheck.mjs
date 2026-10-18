// After quickset and a restart: the clip still has what quickset chose.
import { rulerMap, tab } from "./_preview.mjs";
import { checks, rowOf, selected } from "./_anim.mjs";
import { QUICK } from "./quickset.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  await win.mouse.click(map.x(1.5), await rowOf(ctx, QUICK.type));
  await win.waitForTimeout(600);
  await tab(win, "Animation");
  check(`${QUICK.value} kept after closing the app`, (await selected(win, QUICK.label)) === QUICK.value, await selected(win, QUICK.label));
  return report();
};
