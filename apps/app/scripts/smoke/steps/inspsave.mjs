// Before `reopen` (after the inspector steps): the engine's frames at 1, 2.5 and 4 s and the
// clip as saved, kept for `inspcheck`.
import { engineFrame, rulerMap, seek } from "./_preview.mjs";
import { mediaClip } from "./_inspector.mjs";

export const TIMES = [1, 2.5, 4];

export default async (ctx) => {
  ctx.map ??= await rulerMap(ctx.win);
  const frames = [];
  for (const s of TIMES) {
    await seek(ctx.win, ctx.map, s);
    frames.push((await engineFrame(ctx.win)).sum);
  }
  const clip = await mediaClip(ctx);
  ctx.inspSaved = { frames, clip };
  return `frames ${frames.join(", ")}; keys ${Object.keys(clip.keyframes ?? {}).join(", ")}`;
};
