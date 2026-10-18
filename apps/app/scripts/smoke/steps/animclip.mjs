// A video's Animation tab, through its cards (after import timeline, the whole clip): the In,
// Out and Combo sub-tabs and what each offers; Fade In darkens the clip's start and nothing
// else, at 0.5 s; its duration bounded by the clip; Zoom Out as the Out changes the end; a Combo
// replaces both (and its tab has no duration), an In replaces the Combo; ⌘Z / ⇧⌘Z; None.
// Compares the engine's frames with the clip drawn without animations.
import { diff, grab, rulerMap, seek } from "./_preview.mjs";
import { checks, choose, clipsWhere, duration, note, options, pick, savedClips, savedProject, selected, setDuration } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = (ctx.map ??= await rulerMap(win));
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  const end = Math.floor((+video.endTick / 1e6) * 24) / 24;
  const TIMES = { start: 0.25, mid: 5, end: Math.round((end - 0.25) * 24) / 24 };
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  for (const [k, s] of Object.entries(TIMES)) await at(s, `none@${k}`);
  const changed = async (k) => {
    await at(TIMES[k], `a@${k}`);
    return (await diff(win, `none@${k}`, `a@${k}`)).n;
  };
  const saved = async () => (await savedClips(win, udDir)).find((c) => c.clipId === video.clipId);
  const open = () => pick(ctx, doc, video.clipId, 5);

  await open();
  const ins = await options(win, "In");
  check("In offers None and the clip moves", ins.join() === "None,Fade In,Zoom In,Zoom Out,Slide,Rotate,Spin,Bounce,Shake", ins.join());
  const outs = await options(win, "Out");
  check("Out offers None and the clip moves", outs.join() === "None,Fade Out,Zoom In,Zoom Out,Slide,Rotate,Spin,Bounce,Shake", outs.join());
  const combos = await options(win, "Combo");
  check("Combo offers None, Swing, Shake, Pulse, Spin", combos.join() === "None,Swing,Shake,Pulse,Spin", combos.join());
  check("nothing chosen: None, no duration", (await selected(win, "In")) === "None" && (await duration(win)) === null);
  await shot("a1-in-tab");

  await choose(win, "In", "Fade In");
  let c = await saved();
  const d = await duration(win);
  check("Fade In: chosen, 0.5 s, saved", (await selected(win, "In")) === "Fade In" && d?.value === 0.5 && c.animationIn?.type === "fade_in", `${JSON.stringify(d)} ${JSON.stringify(c.animationIn)}`);
  check("its duration stops at the clip's length", Math.abs((d?.max ?? 0) - (+video.endTick - +video.startTick) / 1e6) < 0.05, JSON.stringify(d));
  const start = await changed("start");
  const mid = await changed("mid");
  check("Fade In: the start changed, the middle not", start > 1000 && mid === 0, `changed ${start}, ${mid}`);
  await open();
  await setDuration(win, 1);
  check("its duration 1 s, saved", (await saved()).animationIn?.duration === 1, JSON.stringify((await saved()).animationIn));
  await shot("a2-fade-in");

  await open();
  await choose(win, "Out", "Zoom Out");
  c = await saved();
  check("Zoom Out: saved as the Out, the In kept", c.animationOut?.type === "zoom_out" && c.animationIn?.type === "fade_in", `${JSON.stringify(c.animationOut)}`);
  const out = await duration(win);
  check("the Out's duration stops at what the In leaves", Math.abs((out?.max ?? 0) - ((+video.endTick - +video.startTick) / 1e6 - 1)) < 0.05, JSON.stringify(out));
  check("Zoom Out: the end changed", (await changed("end")) > 1000);

  await open();
  await choose(win, "Combo", "Swing");
  c = await saved();
  check("Swing: the Combo replaces the In and the Out", c.animationCombo?.type === "swing" && !c.animationIn && !c.animationOut, JSON.stringify([c.animationCombo, c.animationIn, c.animationOut]));
  check("a Combo has no duration, and says it spans the clip", (await duration(win)) === null && /whole clip/.test(await note(win)), await note(win));
  check("Swing: the middle changed", (await changed("mid")) > 1000);
  await shot("a3-combo");

  await open();
  await undoCase(ctx, check, "an In replacing the Combo", () => choose(win, "In", "Zoom In"), { frame: false });
  c = await saved();
  check("Zoom In: the Combo gone", c.animationIn?.type === "zoom_in" && !c.animationCombo, JSON.stringify([c.animationIn, c.animationCombo]));

  await open();
  await choose(win, "In", "None");
  c = await saved();
  check("None: saved as null, no duration", c.animationIn === null && (await duration(win)) === null, JSON.stringify(c.animationIn));
  check("None: the start as without", (await changed("start")) === 0);
  return report();
};
