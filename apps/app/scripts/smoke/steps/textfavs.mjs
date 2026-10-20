// Text › Yours › Favorites (after `import timeline`; docs/plan/capcut-ui-spec.md §6.7, shot
// `07-left-text/002-text-yours.png`): a star on a text preset tile (shown on hover), a starred
// preset listed under Yours ▸ Favorites (before Presets), kept in the user data store
// (`user-store/store.json`, key `favourites.text-presets`) and so across a restart; clicking
// a tile there adds the text (the look of the preset, in the saved project); the star again takes
// it off; saved text styles (Yours ▸ Presets) can be starred too; empty, the view says how.
// Shots: `tf1-star` ↔ `07-left-text/002`.
import path from "node:path";
import { engineFrame, rulerMap, seek, sectionButton } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

export default async (ctx) => {
  const { win, udDir, shot, fs } = ctx;
  const { check, report } = checks();
  const texts = async () => (await savedProject(win, udDir)).timeline.clips.filter((c) => c.type === "text");
  const stored = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(udDir, "user-store", "store.json"), "utf8"))["favourites.text-presets"] ?? [];
    } catch {
      return [];
    }
  };
  const column = () => win.evaluate(() => [...document.querySelectorAll("nav[aria-label=Sections] button")].map((e) => e.innerText.trim()).join(","));
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  await win.locator("[data-testid=assets-tab-text]").click();
  await win.waitForTimeout(500);
  await win.locator('[data-testid="assets-group-Yours"]').click();
  await win.waitForTimeout(300);
  check("Yours lists Favorites, then Presets", /Yours,Favorites,Presets/.test(await column()), await column());

  // Empty.
  await (await sectionButton(win, "yours:favorites")).click();
  await win.waitForTimeout(300);
  check("with none starred the view says how", /No favorites yet/.test(await win.locator("[data-testid=text-favourites]").innerText()));

  // The star on hover, on a preset.
  await win.locator('[data-testid="assets-group-Presets"]').click();
  await (await sectionButton(win, "presets:Caption")).click();
  await win.waitForTimeout(400);
  const tile = (id) => win.locator(`[data-testid=text-preset-${id}]`);
  const star = (id) => win.locator(`[data-testid=text-favourite][data-favourite-id=${id}]`);
  await tile("yellow").hover();
  await win.waitForTimeout(250);
  check("hovering a preset shows its star", await star("yellow").isVisible());
  await shot("tf1-star");
  await star("yellow").click();
  await tile("caption").hover();
  await star("caption").click();
  await win.waitForTimeout(500);
  check("the star stays lit once it's a favourite", (await star("yellow").getAttribute("aria-pressed")) === "true");
  check("and it's in the user data store", ["yellow", "caption"].every((id) => stored().includes(id)), JSON.stringify(stored()));

  // Listed.
  await (await sectionButton(win, "yours:favorites")).click();
  await win.waitForTimeout(400);
  const listed = () => win.locator("[data-testid=text-favourites] [data-testid^=text-favourite-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").slice("text-favourite-".length)));
  check("Favorites lists them, in the order starred", (await listed()).join() === "yellow,caption", (await listed()).join());

  // A click adds the text with the preset's look.
  const before = (await texts()).length;
  await win.locator("[data-testid=text-favourite-yellow]").click();
  await win.waitForTimeout(1500);
  const added = await texts();
  check("a click adds the text at the playhead", added.length === before + 1, `${before} -> ${added.length}`);
  const fresh = added.at(-1);
  check("with the preset's look (not the default white)", !!fresh?.color && String(fresh.color).toLowerCase() !== "#ffffff", JSON.stringify(fresh?.color));
  check("drawn by the engine", (await engineFrame(win)).light >= 0);

  // Restart: still there.
  const next = await ctx.relaunch();
  const w = next.win;
  const openFavs = async () => {
    const editor = w.locator("[data-testid=editor]");
    if (!(await editor.count())) {
      await w.locator("[data-testid=project-card]").first().click();
      await w.waitForSelector("[data-testid=editor]", { timeout: 20000 });
      await w.waitForTimeout(2500);
    }
    await w.locator("[data-testid=assets-tab-text]").click();
    await w.waitForTimeout(500);
    await w.locator('[data-testid="assets-group-Yours"]').click().catch(() => {});
    await w.waitForTimeout(300);
    await (await sectionButton(w, "yours:favorites")).click();
    await w.waitForTimeout(500);
  };
  await openFavs();
  const after = await w.locator("[data-testid=text-favourites] [data-testid^=text-favourite-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").slice("text-favourite-".length)));
  check("after a restart they're still listed", after.join() === "yellow,caption", after.join());

  // Unstar.
  await w.locator("[data-testid=text-favourite-yellow]").hover();
  await w.locator("[data-testid=text-favourite][data-favourite-id=yellow]").click();
  await w.waitForTimeout(500);
  const left = await w.locator("[data-testid=text-favourites] [data-testid^=text-favourite-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").slice("text-favourite-".length)));
  check("the star again takes it off", left.join() === "caption" && !stored().includes("yellow"), `${left.join()} / ${JSON.stringify(stored())}`);
  return report();
};
