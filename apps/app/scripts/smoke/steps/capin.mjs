// A draft's In animations (after capcut on a draft whose first animated texts have Type 1,
// Type 2 and Typewriter over 2 s, 3 s long from 0, 3 and 6 s): the tab shows each with its
// duration; a shorter duration ends the typing sooner; another animation replaces it; None
// shows the text whole. Compares the engine's frames before and after.
import { diff, grab, rulerMap, seek } from "./_preview.mjs";
import { checks, choose, duration, note, options, pick, savedClips, savedProject, selected, setDuration } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  const doc = await savedProject(win, udDir);
  const texts = doc.timeline.clips.filter((c) => c.type === "text" && c.animationIn).sort((a, b) => +a.startTick - +b.startTick);
  const [t1, t2, tw] = texts.map((c) => c.clipId);
  for (const [id, name] of [[t1, "Type 1"], [t2, "Type 2"], [tw, "Typewriter"]]) {
    await pick(ctx, doc, id);
    const d = await duration(win);
    check(`${name}: shown with 2 s`, (await selected(win, "Animation")) === name && d?.value === 2 && d?.max === 3 && (await note(win)) === "", `${await selected(win, "Animation")} ${JSON.stringify(d)}`);
  }
  await shot("i1-tab");
  await pick(ctx, doc, t1);
  check("offers None, Type 1, Type 2, Typewriter", (await options(win, "Animation")).join() === "None,Type 1,Type 2,Typewriter");

  // Type 1: typing at 1 s, whole at 2.5 s; over 0.8 s, whole at 1 s.
  await at(0, "d@0");
  await at(1, "d@1");
  await at(2.5, "d@2.5");
  await pick(ctx, doc, t1);
  await setDuration(win, 0.8);
  await at(1, "s@1");
  let saved = (await savedClips(win, udDir)).find((c) => c.clipId === t1)?.animationIn;
  check("duration 0.8 s saved", saved?.type === "type_1" && saved?.duration === 0.8, JSON.stringify(saved));
  await pick(ctx, doc, t1);
  await choose(win, "Animation", "None");
  await at(0, "n@0");
  await at(1, "n@1");
  await at(2.5, "n@2.5");
  saved = (await savedClips(win, udDir)).find((c) => c.clipId === t1)?.animationIn;
  check("None saved", saved === null, JSON.stringify(saved));
  const [h0, h1, h25, s1] = [await diff(win, "n@0", "d@0"), await diff(win, "n@1", "d@1"), await diff(win, "n@2.5", "d@2.5"), await diff(win, "n@1", "s@1")];
  check("draft's Type 1: hidden at 0, partly at 1 s, whole at 2.5 s", h0.n > h1.n && h1.n > 0 && h25.n === 0, `pixels hidden ${h0.n}, ${h1.n}, ${h25.n}`);
  check("over 0.8 s: whole at 1 s", s1.n === 0, `pixels hidden ${s1.n}`);

  // Type 2 replaced by Typewriter: a different picture while typing.
  await at(4, "t2@4");
  await pick(ctx, doc, t2);
  await choose(win, "Animation", "Typewriter");
  await at(4, "tw@4");
  saved = (await savedClips(win, udDir)).find((c) => c.clipId === t2)?.animationIn;
  const swap = await diff(win, "t2@4", "tw@4");
  check("Type 2 replaced by Typewriter", saved?.type === "typewriter" && saved?.duration === 2 && swap.n > 0, `${JSON.stringify(saved)}; changed ${swap.n}`);
  return report();
};
