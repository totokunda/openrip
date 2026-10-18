// After texttab and reopen: the text comes back from the project file with every field the
// Text tab set, and the engine draws the same frame of it.
import { engineFrame, seek } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

const FIELDS = ["text", "fontFamily", "fontSize", "fontWeight", "fontStyle", "textDecoration", "textTransform", "color", "letterSpacing", "lineSpacing", "textAlign", "verticalAlign", "strokeEnabled", "stroke", "strokeWidth", "backgroundEnabled", "backgroundColor", "backgroundOpacity", "backgroundCornerRadius", "glowEnabled", "glowColor", "glowIntensity", "glowRange", "glowOffsetX", "glowOffsetY", "shadowEnabled", "shadowColor", "shadowOpacity", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "fillGradient", "textEffect"];

export default async (ctx) => {
  const { win, udDir } = ctx;
  const { check, report } = checks();
  const before = ctx.textTab;
  if (!before) throw new Error("run texttab first");
  const clip = (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === before.id);
  const differ = FIELDS.filter((k) => JSON.stringify(clip?.[k]) !== JSON.stringify(before.clip[k]));
  check(`the reopened text keeps the Text tab's ${FIELDS.length} fields`, clip && differ.length === 0, differ.map((k) => `${k}: ${JSON.stringify(before.clip[k])} → ${JSON.stringify(clip?.[k])}`).join("; "));
  await seek(win, ctx.map, 1.5);
  await win.waitForTimeout(1500);
  const frame = (await engineFrame(win)).sum;
  check("the engine draws the same frame after reopening", frame === before.frame, `${before.frame} → ${frame}`);
  return report();
};
