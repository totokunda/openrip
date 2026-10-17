// Transitions between the app's own video clips (after import timeline, the 10 s standard
// clip): split at 5 s into two adjacent clips; White Flash and White Fade on the first, into
// the second, with their duration and None; the second has no clip after it, so it shows the
// note and draws nothing; no Blink without CapCut's image sequence. Then the first half split
// again at 2.5 s: its transition stays on the half that ends at the cut. Compares the engine's
// frames with the clips drawn without a transition. VIDEO_ROW is the video track's y in CSS px.
import { diff, grab, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { checks, choose, duration, note, options, savedClips, selected, setDuration } from "./_anim.mjs";
import { SPLIT } from "./textcut.mjs";

const ROW = +(process.env.VIDEO_ROW || 796);
const TIMES = [2.5, 4.5, 4.6, 4.875, 4.9, 5, 5.4, 9.9];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  const select = async (s) => {
    await win.mouse.click(map.x(s), ROW);
    await win.waitForTimeout(600);
    await tab(win, "Animation");
  };
  const videos = async () => (await savedClips(win, udDir)).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  for (const s of TIMES) await at(s, `none@${s}`);
  // Two clips: split at 5 s.
  await seek(win, map, 5);
  await win.mouse.click(map.x(2), ROW);
  await win.waitForTimeout(600);
  await settled(win, () => win.mouse.click(...SPLIT));
  check("split in two", (await videos()).length === 2, (await videos()).map((c) => `${c.startTick}-${c.endTick}`).join());

  await select(2);
  await shot("v1-tab");
  check("first: None, no note (a clip follows)", (await selected(win, "Transition")) === "None" && (await note(win)) === "", await note(win));
  const opts = await options(win, "Transition");
  check("offers None, White Flash, White Fade (no Blink)", opts.join() === "None,White Flash,White Fade", opts.join());

  await choose(win, "Transition", "White Flash");
  check("White Flash: chosen, 0.5 s", (await selected(win, "Transition")) === "White Flash" && (await duration(win))?.value === 0.5, JSON.stringify(await duration(win)));
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

  await select(2);
  await choose(win, "Transition", "White Fade");
  await at(5, "a@5");
  const fadeCut = await diff(win, "none@5", "a@5");
  await at(4.9, "a@4.9");
  const fadeIn = await diff(win, "none@4.9", "a@4.9");
  check("White Fade: white at the cut, rising before it", fadeCut.light > 0.99 && fadeIn.n > 0 && fadeIn.light < fadeCut.light, `light ${fadeCut.light.toFixed(2)}, ${fadeIn.light.toFixed(2)}`);
  let v = await videos();
  check("saved on the first clip", v[0]?.transitionOut?.type === "white_fade" && !v[1]?.transitionOut, JSON.stringify(v.map((c) => c.transitionOut)));

  await select(2);
  await setDuration(win, 1);
  check("duration 1 s", (await duration(win))?.value === 1, JSON.stringify(await duration(win)));
  await at(4.6, "a@4.6");
  const early = (await diff(win, "none@4.6", "a@4.6")).n;
  check("duration: starts half a second before the cut", early > 0, `changed ${early}`);
  await select(2);
  await setDuration(win, 9);
  const big = await duration(win);
  check("duration at most 2 s", big?.value === 2 && big?.max === 2, JSON.stringify(big));

  await choose(win, "Transition", "None");
  check("None: no duration", (await duration(win)) === null);
  await at(5, "a@5");
  check("None: nothing at the cut", (await diff(win, "none@5", "a@5")).n === 0);

  // The second clip has none after it.
  await select(7);
  check("last clip: the note says a clip must follow", /starts right where this one ends/.test(await note(win)), await note(win));
  await choose(win, "Transition", "White Flash");
  await at(9.9, "a@9.9");
  const end = (await diff(win, "none@9.9", "a@9.9")).n;
  check("last clip: nothing drawn at its end", end === 0, `changed ${end}`);
  await select(7);
  await choose(win, "Transition", "None");

  // A transition stays at the cut it leads into when its clip is split.
  await select(2);
  await choose(win, "Transition", "White Flash");
  await seek(win, map, 2.5);
  await win.mouse.click(map.x(1), ROW);
  await win.waitForTimeout(600);
  await settled(win, () => win.mouse.click(...SPLIT));
  await shot("v3-split");
  v = await videos();
  check("split: three clips, the transition only on the one ending at 5 s", v.length === 3 && !v[0].transitionOut && v[1].transitionOut?.type === "white_flash", JSON.stringify(v.map((c) => [c.startTick, c.transitionOut?.type ?? null])));
  await at(2.5, "a@2.5");
  const split = (await diff(win, "none@2.5", "a@2.5")).n;
  await at(5, "a@5");
  const kept = await diff(win, "none@5", "a@5");
  check("split: nothing at the new cut, the flash still at 5 s", split === 0 && kept.light > 0.99, `changed ${split}; light ${kept.light.toFixed(2)}`);
  await select(1);
  check("split: the first part's tab shows None", (await selected(win, "Transition")) === "None", await selected(win, "Transition"));
  return report();
};
