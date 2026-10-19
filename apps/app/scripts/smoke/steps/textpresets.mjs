// The left panel's Text tab (after import timeline): its column as CapCut's (Add text, the
// presets' categories, Local captions); the default text tile adds a text at the playhead,
// selected on its Text tab (undone and redone); a category shows only its presets and the
// search filters them; a preset clicked, and one dragged onto the timeline, each add their
// look at the playhead, drawn by the engine.
import { engineFrame, rulerMap, seek, settled, sectionButton } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const texts = async () => (await savedProject(win, udDir)).timeline.clips.filter((c) => c.type === "text");
  const tabs = () => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  const column = () => win.evaluate(() => [...document.querySelectorAll("nav[aria-label=Sections] button")].map((e) => e.innerText.trim()).join(","));
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  await win.locator("[data-testid=assets-tab-text]").click();
  await win.waitForTimeout(500);
  check("the column: Add text, then Presets and Text template folded, Local captions", /^Add text,Presets,Text template,Local captions/.test(await column()), await column());
  await win.locator('[data-testid="assets-group-Presets"]').click();
  await win.waitForTimeout(300);
  check("opening Presets shows its categories", /^Add text,Presets,All,Basic,Title,Caption,Style,Text template,Local captions/.test(await column()), await column());

  // The default text.
  await (await sectionButton(win, "add")).click();
  await shot("tp1-add-text");
  const before = (await texts()).length;
  await undoCase(ctx, check, "default text", () => settled(win, () => win.locator("[data-testid=add-text]").click()));
  const added = await texts();
  const fresh = added.find((c) => c.text === "Default Text" && Math.abs(+c.startTick / 1e6 - 2) < 0.05);
  check("the default text is added at the playhead", added.length === before + 1 && !!fresh, `${before} → ${added.length}`);
  check("and selected on its Text tab", (await tabs()).startsWith("Text,"), await tabs());

  // A category and the search.
  await (await sectionButton(win, "presets:Caption")).click();
  await win.waitForTimeout(300);
  const tiles = () => win.locator("[data-testid=text-presets] [data-testid^=text-preset-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").slice("text-preset-".length)));
  const caption = await tiles();
  check("Caption shows its presets only", caption.length === 3 && ["yellow", "caption", "caption_box"].every((p) => caption.includes(p)), caption.join(","));
  await shot("tp2-presets");
  await (await sectionButton(win, "presets:All")).click();
  await win.locator("[data-testid=text-presets-search]").fill("neo");
  await win.waitForTimeout(300);
  check("the search filters the presets", JSON.stringify(await tiles()) === JSON.stringify(["neon"]), (await tiles()).join(","));

  // A preset clicked: its look (an Effects style) at the playhead.
  const f0 = (await engineFrame(win)).sum;
  await settled(win, () => win.locator("[data-testid=text-preset-neon]").click());
  const neon = (await texts()).find((c) => c.textEffect?.id === "neon");
  check("a preset adds its look, drawn by the engine", !!neon && (await engineFrame(win)).sum !== f0, neon ? `${neon.text} at ${+neon.startTick / 1e6}s` : "none");
  await win.locator("[data-testid=text-presets-search]").fill("");

  // A preset dragged onto the timeline.
  const n = (await texts()).length;
  const f1 = (await engineFrame(win)).sum;
  await settled(win, () => win.locator("[data-testid=text-preset-title]").dragTo(win.locator("[data-testid=timeline]"), { targetPosition: { x: 400, y: 120 } }));
  const after = await texts();
  const title = after.find((c) => c.text === "Title" && c.fontSize === 56);
  check("a preset dragged onto the timeline is added at the playhead", after.length === n + 1 && !!title && Math.abs(+title.startTick / 1e6 - 2) < 0.05 && (await engineFrame(win)).sum !== f1, `${n} → ${after.length}`);
  await shot("tp3-dragged");

  // Local captions: the caption import, as in the Captions tab.
  await (await sectionButton(win, "captions")).click();
  await win.waitForTimeout(300);
  check("Local captions shows the caption import", (await win.locator("[data-testid=captions-add] [data-testid=captions-import]").count()) === 1);
  return report();
};
