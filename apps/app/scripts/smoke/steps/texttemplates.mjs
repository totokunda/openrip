// The Text tab's templates (after `import timeline`; `CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1`, built
// app, no dev server), as CapCut's Text template section (docs/plan/capcut-ui-spec.md §6.7): the
// column's group (Favorites, All, the categories) and 86 px tiles drawn by the engine; a category and
// the search; a hovered tile playing (its picture changing); a click previewing in the player and
// adding nothing; "+" adding a multi-layer template as a group on new tracks at the playhead (the
// engine's frame changes; ⌘Z and ⇧⌘Z); its words edited in the group's Text template tab and styled
// from the Text tab; favourites; a tile dragged onto the timeline; a reopen (the groups come back,
// drawn the same); an export showing the template; and every template added once without errors.
// Shots are named after the CapCut reference: `tt1-templates` ↔ `07-left-text/004-text-template-default`.
import { execFileSync } from "node:child_process";
import { engineFrame, goHome, now, previewRect, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { exporter, ffmpeg } from "./_audio.mjs";

const CATEGORIES = ["Titles", "Lower thirds", "Social", "Quotes", "Countdowns", "Labels", "Retro", "Minimal"];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const doc = () => savedProject(win, udDir);
  const groups = async () => (await doc()).timeline.clips.filter((c) => c.type === "group");
  const tabs = () => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  const tiles = () => win.locator("[data-testid=text-templates] [data-testid=text-template-tile]").evaluateAll((els) => els.map((e) => e.dataset.template));
  const section = async (id) => {
    await win.locator(`[data-testid='assets-section-templates:${id}']`).click();
    await win.waitForTimeout(500);
  };
  const tile = (id) => win.locator(`[data-testid=text-template-tile][data-template=${id}]`);
  const addFrom = async (id) => {
    await win.mouse.move(5, 5);
    await tile(id).hover();
    await settled(win, () => tile(id).locator("[data-testid=text-template-add]").click());
    await win.waitForTimeout(400);
  };
  const dataOf = (id) => tile(id).locator("[data-testid=text-template-picture]").evaluate((c) => c.toDataURL());

  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  await win.locator("[data-testid=assets-tab-text]").click();
  await win.waitForTimeout(500);

  // ---- The column and the tiles ----------------------------------------------------------------------------
  const names = await win.evaluate(() => [...document.querySelectorAll("nav[aria-label=Sections] button")].map((e) => e.innerText.trim()));
  const at = names.indexOf("Text template");
  check("the column has a Text template group: Favorites, All and the categories", at > 0 && names.slice(at + 1, at + 11).join() === ["Favorites", "All", ...CATEGORIES].join(), names.join(","));
  await section("All");
  await win.waitForFunction(() => document.querySelectorAll("[data-testid=text-template-picture][data-ready='1']").length >= 12, null, { timeout: 60000 });
  const all = await tiles();
  check("All lists 50 or more templates", all.length >= 50, `${all.length}`);
  const sizes = await win.evaluate(() => [...document.querySelectorAll("[data-testid=text-template-tile]")].slice(0, 4).map((t) => { const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) }; }));
  check("tiles are 86 px, 16 px apart", sizes.every((s) => s.w === 86 && s.h === 86) && sizes[1].x - sizes[0].x === 102, JSON.stringify(sizes.slice(0, 2)));
  const drawn = await win.evaluate(() => {
    const c = document.querySelector("[data-testid=text-template-picture]");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 64) seen.add(`${d[i] >> 4}.${d[i + 1] >> 4}.${d[i + 2] >> 4}`);
    return seen.size;
  });
  check("a tile shows the engine's picture (more than its backdrop)", drawn > 3, `${drawn} colours`);
  await shot("tt1-templates");

  // Categories and the search.
  for (const c of CATEGORIES) {
    await section(c);
    const ids = await tiles();
    const cats = await win.locator("[data-testid=text-template-tile]").evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
    check(`${c} lists its templates only`, ids.length >= 5 && cats.length === 1 && cats[0] === c, `${ids.length} ${cats}`);
  }
  await section("Social");
  const social = await tiles();
  await win.locator("[data-testid=text-templates-search]").fill("subscribe");
  await win.waitForTimeout(400);
  check("the search finds a template by a word, across categories", JSON.stringify(await tiles()) === JSON.stringify(["subscribe-button"]), (await tiles()).join());
  await win.locator("[data-testid=text-templates-search]").fill("lower thirds");
  await win.waitForTimeout(400);
  check("and by its category", (await tiles()).length === 7, `${(await tiles()).length}`);
  await win.locator("[data-testid=text-templates-search]").fill("zzqqxx");
  await win.waitForTimeout(400);
  check("a search matching nothing says so", /No templates match/.test(await win.locator("[data-testid=text-templates]").innerText()));
  await win.locator("[data-testid=text-templates-search]").fill("");
  await win.waitForTimeout(300);
  check("the category is back after clearing the search", JSON.stringify(await tiles()) === JSON.stringify(social));

  // ---- A hover plays the template ----------------------------------------------------------------------------
  await win.mouse.move(5, 5);
  await win.waitForFunction(() => document.querySelector("[data-testid=text-template-tile][data-template=subscribe-button] [data-ready='1']"), null, { timeout: 30000 });
  const still = await dataOf("subscribe-button");
  await tile("subscribe-button").hover();
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    await win.waitForTimeout(150);
    seen.add(await dataOf("subscribe-button"));
  }
  check("a hovered tile plays: its picture changes", seen.size >= 3, `${seen.size} pictures`);
  await shot("tt2-hover");
  await win.mouse.move(5, 5);
  await win.waitForTimeout(500);
  check("and rests on its still when the pointer leaves", (await dataOf("subscribe-button")) === still);

  // ---- A click previews and adds nothing ----------------------------------------------------------------------
  const ids0 = JSON.stringify((await doc()).timeline.clips.map((c) => c.clipId));
  const player = await previewRect(win);
  const playerShot = () => win.screenshot({ clip: { x: player.x, y: player.y, width: player.w, height: player.h } });
  const before = await playerShot();
  await tile("subscribe-button").click();
  await win.waitForTimeout(1500);
  check("a click marks the tile", (await tile("subscribe-button").getAttribute("aria-pressed")) === "true");
  check("the player shows the template", !before.equals(await playerShot()));
  check("and nothing is added", JSON.stringify((await doc()).timeline.clips.map((c) => c.clipId)) === ids0);
  await shot("tt3-preview");
  await tile("subscribe-button").click();
  await win.waitForTimeout(400);
  check("a second click puts the preview away", (await tile("subscribe-button").getAttribute("aria-pressed")) === "false" && before.equals(await playerShot()));

  // ---- "+" adds a multi-layer template as a group ---------------------------------------------------------------------
  const tracks0 = (await doc()).timeline.tracks.length;
  // The button is drawn from a little way in: its frame at 3.3 s before and after.
  await seek(win, ctx.map, 3.3);
  const f0 = (await engineFrame(win)).sum;
  await seek(win, ctx.map, 2);
  await undoCase(ctx, check, "add a template", () => addFrom("subscribe-button"), { frame: false });
  let d = await doc();
  const group = d.timeline.clips.find((c) => c.type === "group" && c.template?.id === "subscribe-button");
  const kids = group ? d.timeline.clips.filter((c) => c.groupId === group.clipId) : [];
  check("a group of the template's four layers, at the playhead", !!group && kids.length === 4 && Math.abs(+group.startTick / 1e6 - 2) < 0.05 && group.children.flat().length === 4, group ? `${kids.length} children at ${+group.startTick / 1e6}s` : "none");
  check("its layers are texts and shapes, hidden under the group, starting with the playhead", kids.filter((c) => c.type === "text").length === 1 && kids.filter((c) => c.type === "shape").length === 3 && kids.every((c) => c.hidden && +c.startTick / 1e6 >= 2 - 0.01), kids.map((c) => `${c.type}@${+c.startTick / 1e6}`).join(" "));
  const gt = d.timeline.tracks.find((t) => t.timelineId === group?.timelineId);
  check("on a new track of its own (the layers' tracks fold into it, as any group's)", d.timeline.tracks.length === tracks0 + 1 && gt?.type === "media" && d.timeline.clips.filter((c) => c.timelineId === group.timelineId).length === 1, `${tracks0} → ${d.timeline.tracks.length}`);
  check("the group is selected on its Text template tab", (await tabs()).startsWith("Text template,"), await tabs());
  await seek(win, ctx.map, 3.3);
  await win.waitForTimeout(600);
  check("the engine's frame changes", (await engineFrame(win)).sum !== f0);
  // The ruler click let go of the group: a click on its bar brings back its tab.
  await select(ctx, d, group.clipId, 5);
  check("a click on the group opens its Text template tab", (await tabs()).startsWith("Text template,"), await tabs());
  await shot("tt4-added");

  // ---- Its words, in the fields ------------------------------------------------------------------------------------------------
  const field = win.locator("[data-testid=template-field-input]").first();
  check("the text is a field, named", (await win.locator("[data-testid=template-field]").count()) === 1 && (await field.inputValue()) === "SUBSCRIBE");
  const f1 = (await engineFrame(win)).sum;
  await undoCase(ctx, check, "edit a template's words", async () => {
    await field.fill("JOIN THE CREW");
    await win.waitForTimeout(600);
  });
  d = await doc();
  check("editing the field changes the layer's text", d.timeline.clips.some((c) => c.groupId === group.clipId && c.text === "JOIN THE CREW"));
  check("and the engine draws it", (await engineFrame(win)).sum !== f1);
  await win.locator("[data-testid=template-field-style]").first().click();
  await win.waitForTimeout(500);
  check("a field's brush opens that text on the Text tab", (await tabs()).startsWith("Text,") && (await win.locator("[data-testid=text-box]").inputValue()) === "JOIN THE CREW", await tabs());
  await shot("tt5-text-tab");
  // Back to the group: click it on the timeline.
  d = await doc();
  await select(ctx, d, group.clipId, +group.startTick / 1e6 + 3);
  check("the group on the timeline selects it again", (await tabs()).startsWith("Text template,"), await tabs());

  // ---- Favourites ----------------------------------------------------------------------------------------------------------------------
  await section("Social");
  await tile("like-heart").hover();
  await tile("like-heart").locator("[data-testid=text-template-favourite]").click();
  await section("Favorites");
  check("a starred template is listed under Favorites", JSON.stringify(await tiles()) === JSON.stringify(["like-heart"]), (await tiles()).join());
  await tile("like-heart").hover();
  await tile("like-heart").locator("[data-testid=text-template-favourite]").click();
  await win.waitForTimeout(300);
  check("and leaves it when unstarred", (await tiles()).length === 0);

  // ---- A tile dragged onto the timeline ------------------------------------------------------------------------------------------------
  await section("Social");
  const n = (await groups()).length;
  const head = await now(win);
  const f2 = (await engineFrame(win)).sum;
  await settled(win, () => tile("like-heart").dragTo(win.locator("[data-testid=timeline]"), { targetPosition: { x: 400, y: 160 } }));
  await win.waitForTimeout(500);
  const heart = (await groups()).find((g) => g.template?.id === "like-heart");
  check("a template dragged onto the timeline is added at the playhead", (await groups()).length === n + 1 && !!heart && Math.abs(+heart.startTick / 1e6 - head) < 0.05, `${head} ${heart?.startTick}`);
  check("and the engine draws it", (await engineFrame(win)).sum !== f2);

  // ---- Reopen --------------------------------------------------------------------------------------------------------------------------------------
  await seek(win, ctx.map, 3);
  await win.waitForTimeout(800);
  const frame3 = (await engineFrame(win)).sum;
  const saved = JSON.stringify((await groups()).map((g) => [g.template?.id, g.children]));
  const name = await win.locator("[data-testid=project-name]").inputValue();
  await goHome(win);
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(3000);
  await goHome(win);
  await win.locator("[data-testid=project-card]").filter({ has: win.getByText(name, { exact: true }) }).first().locator("button[title^='Open ']").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(6000);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 3);
  await win.waitForTimeout(1500);
  check("after reopening the groups are as saved", JSON.stringify((await groups()).map((g) => [g.template?.id, g.children])) === saved);
  check("and the engine draws the same frame", (await engineFrame(win)).sum === frame3);
  await win.locator("[data-testid=assets-tab-text]").click();
  await shot("tt6-reopened");

  // ---- Export ------------------------------------------------------------------------------------------------------------------------------------------
  const exportAs = await exporter(ctx);
  const file = await exportAs("texttemplates");
  const red = (s) => {
    const raw = execFileSync(ffmpeg, ["-v", "error", "-ss", String(s), "-i", file, "-frames:v", "1", "-vf", "scale=135:240", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    let k = 0;
    for (let i = 0; i < raw.length; i += 3) if (raw[i] > 200 && raw[i + 1] < 90 && raw[i + 2] < 110) k++;
    return k;
  };
  const [during, away] = [red(3.2), red(0.5)];
  check("the exported file shows the template's button while it lasts", during > away + 20, `${during} red pixels at 3.2 s, ${away} at 0.5 s`);

  // ---- Every template adds without errors -----------------------------------------------------------------------------------------------
  await win.locator("[data-testid=assets-tab-text]").click();
  await section("All");
  const errors0 = ctx.logs.filter((l) => /pageerror|\[renderer:error\]/.test(l)).length;
  const g0 = (await groups()).length;
  for (const id of all) await addFrom(id);
  await win.waitForTimeout(1500);
  const g1 = await groups();
  check("every template adds a group", g1.length === g0 + all.length && all.every((id) => g1.some((g) => g.template?.id === id)), `${g0} → ${g1.length}`);
  check("without a page error", ctx.logs.filter((l) => /pageerror|\[renderer:error\]/.test(l)).length === errors0, ctx.logs.slice(-3).join(" | ").slice(0, 300));
  await shot("tt7-all-added");
  return report();
};
