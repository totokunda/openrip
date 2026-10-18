// Animation tab check on an opened draft: Typewriter on its first caption and White Flash on
// its first video that another clip follows on the same track (both found in the project as
// saved), and the engine's frames checked, a quarter second into the caption and at the cut.
import { engineFrame, rulerMap, seek, tab } from "./_preview.mjs";
import { clipsWhere, savedProject, select } from "./_anim.mjs";

const choose = async (win, option) => {
  await win.locator("[data-testid=inspector] [role=tabpanel] [role=combobox]").first().click();
  await win.waitForTimeout(300);
  await win.getByRole("option", { name: option, exact: true }).click();
  await win.waitForTimeout(1500);
};

export default async (ctx) => {
  const { win, shot, clock, udDir } = ctx;
  const out = [];
  await win.keyboard.press("v");
  const map = (ctx.map ??= await rulerMap(win));
  const doc = await savedProject(win, udDir);
  const caption = clipsWhere(doc, (c) => c.type === "text")[0];
  const video = clipsWhere(doc, (c) => c.type === "video" && doc.timeline.clips.some((d) => d.timelineId === c.timelineId && d.startTick === c.endTick))[0];
  if (!caption || !video) throw new Error(`no ${caption ? "video followed by a clip" : "caption"}`);
  const at = +caption.startTick / 1e6 + 0.25;
  const cut = +video.endTick / 1e6;

  await seek(win, map, at);
  const before = await engineFrame(win);
  await select(ctx, doc, caption.clipId);
  await tab(win, "Animation");
  await shot("a1-animation-tab");
  await choose(win, "Typewriter");
  await seek(win, map, at);
  const typing = await engineFrame(win);
  await shot("a2-typewriter");
  out.push(`caption changes with Typewriter: ${before.sum !== typing.sum} (clock ${await clock()})`);

  await seek(win, map, cut);
  const cut0 = await engineFrame(win);
  await select(ctx, doc, video.clipId);
  await tab(win, "Animation");
  await shot("a3-transition-tab");
  await choose(win, "White Flash");
  await seek(win, map, cut);
  const cut1 = await engineFrame(win);
  await shot("a4-white-flash");
  out.push(`lightness at the cut ${cut0.light.toFixed(2)} → ${cut1.light.toFixed(2)} (clock ${await clock()})`);
  return out.join("; ");
};
