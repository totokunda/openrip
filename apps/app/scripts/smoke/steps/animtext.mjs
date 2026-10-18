// The app's own text and its In animation (after newtext): each animation hides the text at
// the clip's start, shows part of it at 0.25 s and all of it after its 0.5 s; a longer
// duration moves that; None brings the text back. Compares the engine's frames with the text
// drawn without an animation. The text's row is found from the project as saved.
import { diff, grab, now, rulerMap, seek, tab } from "./_preview.mjs";
import { checks, choose, clipsWhere, duration, options, savedClips, savedProject, select as selectClip, selected, setDuration } from "./_anim.mjs";
// Where to click the text's bar (0–3 s): at 1.5 s, or 2.4 s when the playhead is near there.
// The playhead's line takes clicks 6 px either side of it, which can be under 0.1 s.
export const textX = async (win, map) => map.x(Math.abs((await now(win)) - 1.5) < 0.4 ? 2.4 : 1.5);
// The frames without an animation, by time, as `none@<s>`.
export const TIMES = [0, 0.25, 0.6, 0.85, 1.2, 1.4, 1.46, 1.6];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  // Clicking the ruler drops the selection: select the text again before using the panel,
  // by its bar away from the playhead (a click on its line would grab it).
  const select = async () => {
    await selectClip(ctx, doc, text.clipId);
    await tab(win, "Animation");
  };
  for (const s of TIMES) await at(s, `none@${s}`);
  // The text as saved (read after the frames, by when newtext's save has landed).
  const doc = await savedProject(win, udDir);
  const text = clipsWhere(doc, (c) => c.type === "text")[0];
  await select();
  await shot("t1-tab");
  check("tab shows None and no duration", (await selected(win, "Animation")) === "None" && (await duration(win)) === null, await selected(win, "Animation"));
  const opts = await options(win, "Animation");
  check("In offers None, the typing ones and the text's moves", opts.join() === "None,Type 1,Type 2,Typewriter,Fade In,Zoom In,Zoom Out,Slide", opts.join());
  const outs = await options(win, "Out");
  check("Out offers None, Fade Out, Zoom In, Zoom Out, Slide", outs.join() === "None,Fade Out,Zoom In,Zoom Out,Slide", outs.join());
  const loops = await options(win, "Loop");
  check("Loop offers None, Pulse, Swing, Shake, Float, Blink", loops.join() === "None,Pulse,Swing,Shake,Float,Blink", loops.join());
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

  // An Out fades the text's end and nothing before it; a Loop moves it all along; None, each.
  await at(2.85, "none@2.85");
  await select();
  await choose(win, "Out", "Fade Out");
  await at(2.85, "o@2.85");
  await at(1.4, "o@1.4");
  const outEnd = (await diff(win, "none@2.85", "o@2.85")).n;
  const outMid = (await diff(win, "none@1.4", "o@1.4")).n;
  clips = await savedClips(win, udDir);
  check("Fade Out: saved, the end fading, the middle not", clips.find((c) => c.type === "text")?.animationOut?.type === "fade_out" && outEnd > 100 && outMid === 0, `changed ${outEnd}, ${outMid}`);
  await select();
  await choose(win, "Out", "None");
  await choose(win, "Loop", "Pulse");
  check("Pulse: 1 s a round", (await duration(win))?.value === 1, JSON.stringify(await duration(win)));
  await at(1.2, "l@1.2");
  const pulsed = (await diff(win, "none@1.2", "l@1.2")).n;
  clips = await savedClips(win, udDir);
  check("Pulse: saved as the Loop, the text moving mid-clip", clips.find((c) => c.type === "text")?.animationLoop?.type === "pulse" && pulsed > 100, `changed ${pulsed}`);
  await select();
  await choose(win, "Loop", "None");
  await at(1.2, "l@1.2");
  check("Loop None: the text as without", (await diff(win, "none@1.2", "l@1.2")).n === 0);
  return report();
};
