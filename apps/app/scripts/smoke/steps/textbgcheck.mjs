// After textbg and reopen: the text comes back from the project file with its Background
// geometry and Curve, and the engine draws the same curved text and box.
import { seek } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { inkBox } from "./textbg.mjs";

const FIELDS = ["backgroundEnabled", "backgroundColor", "backgroundCornerRadius", "backgroundWidth", "backgroundHeight", "backgroundOffsetX", "backgroundOffsetY", "textCurve"];

export default async (ctx) => {
  const { win, udDir } = ctx;
  const { check, report } = checks();
  const before = ctx.textBg;
  if (!before) throw new Error("run textbg first");
  const clip = (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === before.id);
  const differ = FIELDS.filter((k) => JSON.stringify(clip?.[k]) !== JSON.stringify(before.clip[k]));
  check(`the reopened text keeps its Background geometry and Curve (${FIELDS.map((k) => clip?.[k]).join(", ")})`, clip && differ.length === 0, differ.join(","));
  await seek(win, ctx.map, 1.5);
  await win.waitForTimeout(1500);
  const now = await inkBox(win, "r > 235 && g > 235 && b > 235");
  check("the engine draws the same curved text after reopening", now.n === before.curved.n && now.h === before.curved.h && Math.abs(now.cy - before.curved.cy) < 0.5, `${before.curved.n}/${before.curved.h} → ${now.n}/${now.h}`);
  return report();
};
