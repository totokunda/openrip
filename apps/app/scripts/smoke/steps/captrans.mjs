// A draft's transitions (after capcut on a draft with a White Fade and a White Flash, and no
// Blink): the tab shows each with its duration; no Blink without its image sequence; a
// longer duration starts the fade sooner; another transition replaces it; None removes it.
import { diff, grab, rulerMap, seek, tallTimeline } from "./_preview.mjs";
import { checks, choose, duration, note, options, pick, savedClips, savedProject, selected, setDuration } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  await tallTimeline(win);
  const map = (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  const doc = await savedProject(win, udDir);
  const withTr = doc.timeline.clips.filter((c) => c.transitionOut).sort((a, b) => +a.startTick - +b.startTick);
  const saved = async (id) => (await savedClips(win, udDir)).find((c) => c.clipId === id)?.transitionOut;
  const label = { white_fade: "White Fade", white_flash: "White Flash", blink: "Blink" };
  for (const c of withTr) {
    await pick(ctx, doc, c.clipId);
    const d = await duration(win);
    check(`${c.transitionOut.name} at ${(+c.endTick / 1e6).toFixed(2)} s: shown with ${c.transitionOut.duration} s`, (await selected(win, "Transition")) === label[c.transitionOut.type] && d?.value === c.transitionOut.duration && (await note(win)) === "", `${await selected(win, "Transition")} ${JSON.stringify(d)} ${await note(win)}`);
  }
  const fade = withTr.find((c) => c.transitionOut.type === "white_fade");
  const cut = +fade.endTick / 1e6;
  await pick(ctx, doc, fade.clipId);
  await shot("r1-tab");
  const opts = await options(win, "Transition");
  check("offers None, White Flash, White Fade (no Blink)", opts.join() === "None,White Flash,White Fade", opts.join());
  await at(cut, "d@cut");
  await at(cut - 0.35, "d@early");
  check("draft's White Fade: white at the cut", (await diff(win, "d@early", "d@cut")).light > 0.99, (await diff(win, "d@early", "d@cut")).light.toFixed(2));
  await pick(ctx, doc, fade.clipId);
  await setDuration(win, 1);
  await at(cut - 0.35, "l@early");
  let s = await saved(fade.clipId);
  check("duration 1 s: saved, the fade starts sooner", s?.type === "white_fade" && s?.duration === 1 && (await diff(win, "d@early", "l@early")).n > 0, `${JSON.stringify(s)}; changed ${(await diff(win, "d@early", "l@early")).n}`);
  await pick(ctx, doc, fade.clipId);
  await choose(win, "Transition", "White Flash");
  s = await saved(fade.clipId);
  await at(cut, "f@cut");
  // Captions are drawn over the white.
  const flashed = (await diff(win, "d@cut", "f@cut")).light;
  check("replaced by White Flash, white at the cut", s?.type === "white_flash" && s?.duration === 1 && flashed > 0.9, `${JSON.stringify(s)}; light ${flashed.toFixed(2)}`);
  await pick(ctx, doc, fade.clipId);
  await choose(win, "Transition", "None");
  s = await saved(fade.clipId);
  await at(cut, "n@cut");
  check("None: saved, no white at the cut", s === null && (await diff(win, "d@cut", "n@cut")).light < 0.9, `${JSON.stringify(s)}; light ${(await diff(win, "d@cut", "n@cut")).light.toFixed(2)}`);
  // The draft's other transitions are untouched.
  const flash = withTr.find((c) => c.transitionOut.type === "white_flash");
  await at(+flash.endTick / 1e6, "w@cut");
  await at(+flash.endTick / 1e6 + 0.4, "w@after");
  const [w, after] = [(await diff(win, "n@cut", "w@cut")).light, (await diff(win, "n@cut", "w@after")).light];
  check("the draft's White Flash still white at its cut", w > 0.85 && w > after + 0.2, `light ${w.toFixed(2)}, ${after.toFixed(2)} after it`);
  ctx.transitionCut = { id: fade.clipId, cut };
  return report();
};
