// After `audioui` and `reopen`: the Audio tab shows what was left on the clip, read back from
// the saved file (Normalize on with its line, Fill left with right, Telephone at strength 0),
// and the engine still mixes it (an export's channels alike).
import path from "node:path";
import { rulerMap, tab } from "./_preview.mjs";
import { checks, focus } from "./_anim.mjs";
import { field } from "./_undo.mjs";
import { channelDifference, exporter, pcm } from "./_audio.mjs";
import { audioSub } from "./audioui.mjs";

/** The saved project holding the clip `id` (reopening makes another project, saved later). */
export const projectWith = (ctx, id) => {
  const dir = path.join(ctx.udDir, "projects-json");
  for (const f of ctx.fs.readdirSync(dir).filter((f) => /^project-.*\.json$/.test(f))) {
    try {
      const p = JSON.parse(ctx.fs.readFileSync(path.join(dir, f), "utf8"));
      if (p.timeline?.clips?.some((c) => c.clipId === id)) return p;
    } catch {}
  }
  return null;
};

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const doc = projectWith(ctx, ctx.audioClipId);
  if (!doc) throw new Error("no saved project with the clip");
  const video = doc.timeline.clips.find((c) => c.clipId === ctx.audioClipId);
  ctx.map = await rulerMap(win);
  await focus(ctx, doc, video, 2);
  await tab(win, "Audio");
  const inspector = win.locator("[data-testid=inspector]");
  const on = async (name) => (await inspector.locator(`[role=checkbox][aria-label="${name} on"]`).getAttribute("aria-checked")) === "true";
  const line = await inspector.locator("[data-testid=loudness-state]").innerText().catch(() => "");
  check(`Normalize loudness checked, its line shown ("${line}")`, (await on("Normalize loudness")) && /LUFS target/.test(line));
  const fill = await win.locator("[data-testid=fill-channel]").innerText();
  check(`Fill channel checked, "${fill.trim()}"`, (await on("Fill channel")) && fill.trim() === "Fill left with right");
  await shot("auic-1-basic");
  await audioSub(win, "Voice changer");
  const tel = await inspector.locator("[data-testid=voice-telephone]").getAttribute("aria-pressed");
  const strength = await field(win, "Strength").inputValue();
  check(`Telephone picked, Strength ${strength}`, tel === "true" && /^0%?$/.test(strength));
  await shot("auic-2-voice");
  const exportAs = await exporter(ctx);
  const begin = +video.startTick / 1e6;
  const x = pcm(await exportAs("auic-reopened"), begin + 0.25, 4);
  const lr = channelDifference(x);
  check(`the engine still fills the channel (L−R ${lr.toExponential(1)} of the level)`, lr < 0.01);
  return report();
};
