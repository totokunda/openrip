// Trim and split of the app's own text with an In animation (after animtext, whose frames
// without an animation it compares with): Type 1 over 2 s; the clip trimmed to 1.5 s, so the
// animation must end by then (whole on its last frame, 1.46 s at 24 fps); then split at 0.75 s:
// the In stays on the first half and the second shows whole from its start. SPLIT_AT is the
// timeline's split button in CSS px.
import { diff, drag, grab, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { checks, choose, duration, savedClips, selected, setDuration } from "./_anim.mjs";
import { ROW } from "./animtext.mjs";

export const SPLIT = (process.env.SPLIT_AT || "87,703").split(",").map(Number);

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
  await select(1.0);
  await choose(win, "Animation", "Type 1");
  await setDuration(win, 2);
  // Trim the end from 3 s to 1.5 s by its handle.
  await settled(win, () => drag(win, map.x(3) - 1, ROW, map.x(1.5), ROW));
  await shot("c1-trimmed");
  let text = (await savedClips(win, udDir)).filter((c) => c.type === "text");
  check("trimmed to 1.5 s", text.length === 1 && text[0].endTick === "1500000", text.map((c) => c.endTick).join());
  const d = await duration(win);
  check("trim: duration shown within the clip", d?.value <= 1.5 && d?.max <= 1.5, JSON.stringify(d));
  // Its last frame (1.4 s isn't a frame at 24 fps, and the one before the last still types).
  await at(1.46, "a@1.46");
  const end = (await diff(win, "none@1.46", "a@1.46")).n;
  check("trim: whole by the clip's end (its last frame)", end === 0, `pixels hidden ${end}`);
  // Split at 0.75 s; the panel then shows the second half (both are selected, it the last).
  await seek(win, map, 0.75);
  await select(0.4);
  await settled(win, () => win.mouse.click(...SPLIT));
  await shot("c2-split");
  text = (await savedClips(win, udDir)).filter((c) => c.type === "text").sort((a, b) => +a.startTick - +b.startTick);
  check("split in two", text.length === 2, text.map((c) => `${c.startTick}-${c.endTick}`).join());
  check("split: the In stays on the first half only", text[0]?.animationIn?.type === "type_1" && !text[1]?.animationIn, JSON.stringify(text.map((c) => c.animationIn)));
  check("split: the second half's tab shows None", (await selected(win, "Animation")) === "None", await selected(win, "Animation"));
  await at(0.85, "a@0.85");
  const second = (await diff(win, "none@0.85", "a@0.85")).n;
  check("split: the second half is whole from its start", second === 0, `pixels hidden at 0.85 s ${second}`);
  await at(0.25, "a@0.25");
  const first = (await diff(win, "none@0.25", "a@0.25")).n;
  check("split: the first half still types", first > 0, `pixels hidden at 0.25 s ${first}`);
  await select(0.4);
  const d1 = await duration(win);
  // The field shows tenths: 0.75 s reads 0.8.
  check("split: the first half shows Type 1 within its 0.75 s", (await selected(win, "Animation")) === "Type 1" && d1?.value <= 0.8 && d1?.max === 0.75, JSON.stringify(d1));
  return report();
};
