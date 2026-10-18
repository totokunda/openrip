// Transitions between the app's own video clips (after import timeline, the standard clip):
// split at 5 s into two adjacent clips; White Flash put on the cut by the Transitions tab's +
// with the first half selected, then White Fade in its place, their duration (at most the
// shorter clip) and ⌫; no Blink without CapCut's image sequence; + with the last clip selected
// goes on the cut before it, nothing at its end. Then the first half split again at 2.5 s: the
// transition stays on the half that ends at the cut. Compares the engine's frames with the
// clips drawn without a transition. The video's row is found from the project.
import { clickSplit, diff, grab, rulerMap, seek, settled } from "./_preview.mjs";
import {
  addTransition,
  checks,
  deleteTransition,
  duration,
  pickTransition,
  rowOf,
  savedClips,
  savedProject,
  select,
  setDuration,
  transitionName,
  transitionsOffered,
} from "./_anim.mjs";

const TIMES = [2.5, 4.5, 4.6, 4.875, 4.9, 5, 5.4, 9.9];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const ROW = await rowOf(ctx, "video");
  const { check, report } = checks();
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  const doc = () => savedProject(win, udDir);
  const videos = async () => (await savedClips(win, udDir)).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  for (const s of TIMES) await at(s, `none@${s}`);
  // Two clips: split at 5 s.
  await seek(win, map, 5);
  await win.mouse.click(map.x(2), ROW);
  await win.waitForTimeout(600);
  await settled(win, () => clickSplit(win));
  let v = await videos();
  check("split in two", v.length === 2, v.map((c) => `${c.startTick}-${c.endTick}`).join());

  const opts = await transitionsOffered(win);
  check("the Transitions tab offers White Flash and White Fade, no Blink", opts.includes("White Flash") && opts.includes("White Fade") && !opts.includes("Blink"), opts.join());
  await select(ctx, await doc(), v[0].clipId, 2);
  await shot("v1-tab");
  await addTransition(win, "White Flash");
  check("White Flash: chosen, 0.5 s", (await transitionName(win)) === "White Flash" && (await duration(win))?.value === 0.5, JSON.stringify(await duration(win)));
  await at(5, "a@5");
  const cut = await diff(win, "none@5", "a@5");
  await at(4.875, "a@4.875");
  const quarter = await diff(win, "none@4.875", "a@4.875");
  await at(4.5, "a@4.5");
  const before = (await diff(win, "none@4.5", "a@4.5")).n;
  await at(5.4, "a@5.4");
  const after = (await diff(win, "none@5.4", "a@5.4")).n;
  check("White Flash: white at the cut, half way a quarter before, nothing outside", cut.light > 0.99 && quarter.n > 0 && quarter.light < 0.95 && before === 0 && after === 0, `light ${cut.light.toFixed(2)}, ${quarter.light.toFixed(2)}; changed ${before}, ${after}`);
  await shot("v2-flash");

  await pickTransition(ctx, await doc(), v[0].clipId);
  await addTransition(win, "White Fade");
  await at(5, "a@5");
  const fadeCut = await diff(win, "none@5", "a@5");
  await at(4.9, "a@4.9");
  const fadeIn = await diff(win, "none@4.9", "a@4.9");
  check("White Fade: white at the cut, rising before it", fadeCut.light > 0.99 && fadeIn.n > 0 && fadeIn.light < fadeCut.light, `light ${fadeCut.light.toFixed(2)}, ${fadeIn.light.toFixed(2)}`);
  v = await videos();
  check("saved on the first clip", v[0]?.transitionOut?.type === "white_fade" && !v[1]?.transitionOut, JSON.stringify(v.map((c) => c.transitionOut)));

  await pickTransition(ctx, await doc(), v[0].clipId);
  await setDuration(win, 1);
  check("duration 1 s", (await duration(win))?.value === 1, JSON.stringify(await duration(win)));
  await at(4.6, "a@4.6");
  const early = (await diff(win, "none@4.6", "a@4.6")).n;
  check("duration: starts half a second before the cut", early > 0, `changed ${early}`);
  await pickTransition(ctx, await doc(), v[0].clipId);
  await setDuration(win, 9);
  const big = await duration(win);
  check("duration at most the shorter clip (5 s)", big?.value === 5 && big?.max === 5, JSON.stringify(big));

  await deleteTransition(win);
  check("⌫: the inspector goes back to the project's", (await transitionName(win)) === null);
  await at(5, "a@5");
  check("⌫: nothing at the cut", (await diff(win, "none@5", "a@5")).n === 0);

  // The second clip has none after it: + puts the transition on the cut before it.
  await select(ctx, await doc(), v[1].clipId, 7);
  await addTransition(win, "White Flash");
  v = await videos();
  check("last clip: + goes on the cut before it", v[0].transitionOut?.type === "white_flash" && !v[1].transitionOut, JSON.stringify(v.map((c) => c.transitionOut?.type ?? null)));
  await at(9.9, "a@9.9");
  const end = (await diff(win, "none@9.9", "a@9.9")).n;
  check("last clip: nothing drawn at its end", end === 0, `changed ${end}`);

  // A transition stays at the cut it leads into when its clip is split.
  await seek(win, map, 2.5);
  await win.mouse.click(map.x(1), ROW);
  await win.waitForTimeout(600);
  await settled(win, () => clickSplit(win));
  await shot("v3-split");
  v = await videos();
  check("split: three clips, the transition only on the one ending at 5 s", v.length === 3 && !v[0].transitionOut && v[1].transitionOut?.type === "white_flash", JSON.stringify(v.map((c) => [c.startTick, c.transitionOut?.type ?? null])));
  await at(2.5, "a@2.5");
  const split = (await diff(win, "none@2.5", "a@2.5")).n;
  await at(5, "a@5");
  const kept = await diff(win, "none@5", "a@5");
  check("split: nothing at the new cut, the flash still at 5 s", split === 0 && kept.light > 0.99, `changed ${split}; light ${kept.light.toFixed(2)}`);
  check("split: no marker at the new cut", !(await pickTransition(ctx, await doc(), v[0].clipId)));
  return report();
};
