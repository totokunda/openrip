// Undo and redo on an opened CapCut draft (see _undo.mjs): edits to a caption (its case and
// font, which the engine lays out again and the box follows), to a video (position, an Adjust
// slider dragged) and on the timeline (the caption moved, then deleted); then everything
// undone at once must give back the draft as opened, frame and project. The caption is the
// draft's first text clip and the video its first video or photo, as saved; the playhead sits
// a third of the way into the caption. With DRAFT_ADJUST set, the clip is the first with the
// draft's own adjustments instead (and the playhead in it): one set, one removed, then all put
// back.
import { drag, rulerMap, seek, settled } from "./_preview.mjs";
import { bar, checks, clipsWhere, savedProject, select } from "./_anim.mjs";
import { openTab, press, state, textCase, textFont, thumb, typeInto, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, udDir } = ctx;
  const { check, report } = checks();
  await win.keyboard.press("v");
  const map = (ctx.map ??= await rulerMap(win));
  const doc = await savedProject(win, udDir);
  const caption = clipsWhere(doc, (c) => c.type === "text")[0];
  const video = process.env.DRAFT_ADJUST
    ? clipsWhere(doc, (c) => c.draftAdjustments?.length)[0]
    : clipsWhere(doc, (c) => c.type === "video" || c.type === "image")[0];
  if (!caption || !video) throw new Error(`no ${caption ? "video" : "caption"}`);
  const within = (c, f) => Math.round((+c.startTick / 1e6 + f * ((+c.endTick - +c.startTick) / 1e6)) * 24) / 24;
  const headAt = within(process.env.DRAFT_ADJUST ? video : caption, 1 / 3);
  const toHead = () => seek(win, map, headAt);
  await toHead();
  // Select by clicking its bar, away from the playhead (undo puts clips back with their ids).
  const pick = async (clip) => select(ctx, doc, clip.clipId);
  const CASES = process.env.DRAFT_ADJUST
    ? {
        "draft slider": async () => {
          await pick(video);
          await openTab(win, "Adjust");
          const input = win.locator("[data-draft-adjustment] input").first();
          await input.scrollIntoViewIfNeeded();
          await input.click({ clickCount: 3 });
          await input.fill("40");
          await settled(win, () => input.press("Enter"));
        },
        "draft slider removed": async () => {
          await pick(video);
          await openTab(win, "Adjust");
          const row = win.locator("[data-draft-adjustment]").filter({ has: win.locator("input") }).first();
          await settled(win, () => row.locator("button[aria-label^='Remove']").click());
        },
        "draft's put back": async () => {
          await pick(video);
          await openTab(win, "Adjust");
          await settled(win, () => win.locator("[title=\"Put back the draft's adjustments\"]").click());
        },
      }
    : {
        "caption case": async () => {
          await pick(caption);
          await openTab(win, "Text");
          await textCase(win, "uppercase");
        },
        "caption font": async () => {
          await pick(caption);
          await openTab(win, "Text");
          await textFont(win, process.env.BOX_FONT || "Georgia");
        },
        "video position": async () => {
          await pick(video);
          await openTab(win, "Transform");
          await typeInto(win, "Position", 60);
        },
        "video slider": async () => {
          await pick(video);
          await openTab(win, "Adjust");
          const t = await thumb(win, "Brightness");
          await settled(win, () => drag(win, t.x, t.y, t.x + 50, t.y));
        },
        // The caption moved later by about a second, off the playhead.
        "caption moved": async () => {
          await toHead();
          const [x, y] = await bar(ctx, doc, caption.clipId, within(caption, 0.75));
          await settled(win, () => drag(win, x, y, x + map.pps, y));
        },
        "caption deleted": async () => {
          await pick(caption);
          await press(win, "Backspace");
        },
      };
  const opened = await state(ctx);
  for (const [name, edit] of Object.entries(CASES)) {
    try {
      const r = await undoCase(ctx, check, name, edit);
      if (!r.ok) await ctx.shot(`cu-fail-${name.replace(/\W+/g, "-")}`);
    } catch (e) {
      check(name, false, e.message.split("\n")[0]);
    }
    // "caption moved" leaves the caption a second later: put the caption back under its point.
    if (name === "caption moved") await press(win, "Meta+z");
  }
  // Back to the draft as opened.
  let undos = 0;
  while (!(await win.locator("[title=Undo]").getAttribute("class")).includes("not-allowed") && undos < 40) {
    await settled(win, () => win.locator("[title=Undo]").click(), { timeout: 1500 });
    undos++;
  }
  await toHead();
  const back = await state(ctx);
  check("everything undone gives back the draft as opened", back.doc === opened.doc && back.frame === opened.frame, `${undos} steps; frame ${back.frame === opened.frame}, project ${back.doc === opened.doc}`);
  if (back.doc !== opened.doc) {
    ctx.fs.writeFileSync(`${ctx.outDir}/cu-opened.json`, JSON.stringify(JSON.parse(opened.doc), null, 1));
    ctx.fs.writeFileSync(`${ctx.outDir}/cu-back.json`, JSON.stringify(JSON.parse(back.doc), null, 1));
  }
  return report();
};
