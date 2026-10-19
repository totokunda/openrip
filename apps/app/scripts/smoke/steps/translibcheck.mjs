// After translib and reopen: the three shader transitions come back from the saved file with
// their duration and parameters, and the engine still draws them (the frame at each cut is
// neither the clip's before nor the one after the window; outside it, nothing).
import { grab, diff, rulerMap, seek } from "./_preview.mjs";
import { checks, savedClips } from "./_anim.mjs";
import { PICKS } from "./translib.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const map = (ctx.map = await rulerMap(win));
  const v = (await savedClips(win, udDir)).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  check("four clips, the three transitions on the cuts", v.length === 4 && PICKS.every(([type], i) => v[i].transitionOut?.type === type), v.map((c) => c.transitionOut?.type ?? "-").join());
  check("Zoom blur fade kept its strength and 0.8 s", v[0].transitionOut?.params?.strength === 0.9 && v[0].transitionOut?.duration === 0.8, JSON.stringify(v[0].transitionOut));
  check("Soft circle kept Opening off", v[1].transitionOut?.params?.opening === false, JSON.stringify(v[1].transitionOut?.params));
  const cuts = v.slice(0, 3).map((c) => +c.endTick / 1e6);
  for (const [i, c] of cuts.entries()) {
    await seek(win, map, c);
    await grab(win, `cut${i}`);
    await seek(win, map, c + 0.6);
    await grab(win, `after${i}`);
    await seek(win, map, c - 0.6);
    await grab(win, `before${i}`);
    const [a, b] = [(await diff(win, `cut${i}`, `after${i}`)).n, (await diff(win, `cut${i}`, `before${i}`)).n];
    check(`${PICKS[i][1]} is drawn at the cut after a reload (${a}, ${b} pixels unlike the clips either side)`, a > 1500 && b > 1500);
  }
  await seek(win, map, cuts[0]);
  await shot("tl11-reopened");
  return report();
};
