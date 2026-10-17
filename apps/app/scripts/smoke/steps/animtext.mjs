// The app's own text and its In animation (after newtext): each animation hides the text at
// the clip's start, shows part of it at 0.25 s and all of it after its 0.5 s; a longer
// duration moves that; None brings the text back. Compares the engine's frames with the text
// drawn without an animation. TEXT_ROW is the text track's y in CSS px (from n1-text.png).
import { diff, grab, rulerMap, seek, tab } from "./_preview.mjs";
import { checks, choose, duration, options, savedClips, selected, setDuration } from "./_anim.mjs";

export const ROW = +(process.env.TEXT_ROW || 780);
// The frames without an animation, by time, as `none@<s>`.
export const TIMES = [0, 0.25, 0.6, 0.85, 1.2, 1.4, 1.6];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  // Clicking the ruler drops the selection: select the text again before using the panel.
  const select = async () => {
    await win.mouse.click(map.x(1.5), ROW);
    await win.waitForTimeout(600);
    await tab(win, "Animation");
  };
  for (const s of TIMES) await at(s, `none@${s}`);
  await select();
  await shot("t1-tab");
  check("tab shows None and no duration", (await selected(win, "Animation")) === "None" && (await duration(win)) === null, await selected(win, "Animation"));
  const opts = await options(win, "Animation");
  check("offers None, Type 1, Type 2, Typewriter", opts.join() === "None,Type 1,Type 2,Typewriter", opts.join());
  check("no Captions row without spoken words", (await selected(win, "Words")) === null);
  for (const name of ["Type 1", "Type 2", "Typewriter"]) {
    await select();
    await choose(win, "Animation", name);
    const d = await duration(win);
    check(`${name}: chosen, 0.5 s`, (await selected(win, "Animation")) === name && d?.value === 0.5, JSON.stringify(d));
    await at(0, "a@0");
    const whole = (await diff(win, "none@0", "a@0")).n;
    await at(0.25, "a@0.25");
    const half = (await diff(win, "none@0.25", "a@0.25")).n;
    await at(0.6, "a@0.6");
    const after = (await diff(win, "none@0.6", "a@0.6")).n;
    check(`${name}: hidden at 0, partly shown at 0.25 s, whole at 0.6 s`, whole > 200 && half > 0 && half < whole * 0.9 && after === 0, `pixels hidden ${whole}, ${half}, ${after}`);
  }
  // Longer: still typing at 1.2 s, done by 1.6 s.
  await select();
  await setDuration(win, 1.5);
  check("duration 1.5 s", (await duration(win))?.value === 1.5, JSON.stringify(await duration(win)));
  await at(1.2, "a@1.2");
  await at(1.6, "a@1.6");
  const d12 = (await diff(win, "none@1.2", "a@1.2")).n;
  const d16 = (await diff(win, "none@1.6", "a@1.6")).n;
  check("duration: typing at 1.2 s, whole at 1.6 s", d12 > 0 && d16 === 0, `pixels hidden ${d12}, ${d16}`);
  let clips = await savedClips(win, udDir);
  const saved = clips.find((c) => c.type === "text")?.animationIn;
  check("saved with its type and duration", saved?.type === "typewriter" && saved?.duration === 1.5, JSON.stringify(saved));
  // The slider stops at the clip's length (3 s).
  await select();
  await setDuration(win, 9);
  const big = await duration(win);
  check("duration at most the clip's 3 s", big?.value === 3 && big?.max === 3, JSON.stringify(big));
  await shot("t2-duration");
  await choose(win, "Animation", "None");
  check("None: no duration", (await duration(win)) === null);
  await at(0.25, "a@0.25");
  check("None: text whole", (await diff(win, "none@0.25", "a@0.25")).n === 0);
  clips = await savedClips(win, udDir);
  check("None: saved as null", clips.find((c) => c.type === "text")?.animationIn === null, JSON.stringify(clips.find((c) => c.type === "text")?.animationIn));
  return report();
};
