// After `inspsave reopen`: the clip comes back from the file with the inspector's fields (keys,
// colour, compositing, masks) and the engine draws the same frames at the same times.
import { engineFrame, rulerMap, seek } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { mediaClip } from "./_inspector.mjs";
import { TIMES } from "./inspsave.mjs";

const FIELDS = ["keyframes", "color", "blendMode", "chroma", "canvas", "flip", "masks", "transform"];

export default async (ctx) => {
  const { check, report } = checks();
  const before = ctx.inspSaved;
  if (!before) throw new Error("run inspsave first");
  ctx.map = await rulerMap(ctx.win);
  const frames = [];
  for (const s of TIMES) {
    await seek(ctx.win, ctx.map, s);
    frames.push((await engineFrame(ctx.win)).sum);
  }
  const clip = await mediaClip(ctx);
  const same = FIELDS.filter((k) => JSON.stringify(clip[k] ?? null) === JSON.stringify(before.clip[k] ?? null));
  check("the clip's inspector fields come back from the file", same.length === FIELDS.length, `same: ${same.join(", ")}; differ: ${FIELDS.filter((k) => !same.includes(k)).join(", ")}`);
  check("the engine draws the same frames after reopening", frames.every((f, i) => f === before.frames[i]), `${before.frames.join(", ")} → ${frames.join(", ")}`);
  return report();
};
