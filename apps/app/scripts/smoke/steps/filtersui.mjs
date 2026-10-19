// The left panel's Filters tab (after import timeline): its column as CapCut's (Favorites, then
// Filters with its categories); a category shows only its filters; the search, and a search
// that matches nothing; a filter favourited from its tile and found under Favorites (and taken
// off); a click on a tile previews it in the player without touching the saved project; "+"
// adds a filter clip at the playhead on its own track (the engine's frame changes), selected on
// its Filters tab; Intensity set there; each edit undone and redone. Shots are named after the
// CapCut references (f1 ↔ 12-left-filters/001-featured, f2 ↔ 032-unmatched-search-results,
// f3 ↔ 031-favorites, f4 ↔ 033-item-hover, f6 ↔ 24-inspector-filter/001).
import { engineFrame, rulerMap, seek, settled, sectionButton } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { typeInto, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const filtersIn = async () => (await savedProject(win, udDir)).timeline.clips.filter((c) => c.type === "filter");
  const column = () => win.evaluate(() => [...document.querySelectorAll("nav[aria-label=Sections] button")].map((e) => e.innerText.trim()));
  const tiles = () => win.locator("[data-testid=filter-tile]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-filter"), category: e.getAttribute("data-category"), name: e.title })));
  const section = (id) => sectionButton(win, id);
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  const f0 = (await engineFrame(win)).sum;
  const n0 = (await filtersIn()).length;

  // The tab and its column.
  await win.locator("[data-testid=assets-tab-filters]").click();
  await win.waitForTimeout(1500);
  const col = await column();
  check("the column: Favorites, Filters, All, then the categories", col[0] === "Favorites" && col[1] === "Filters" && col[2] === "All" && col.length > 4, col.join(","));
  const all = await tiles();
  check("All lists every filter as a tile, its heading All", all.length > 20 && (await win.locator("[data-testid=filters-heading]").innerText()) === "All", `${all.length} tiles`);
  const box = await win.locator("[data-testid=filter-tile]").first().boundingBox();
  check("a tile is an 86 px square", Math.abs(box.width - 86) < 1 && Math.abs(box.height - 86) < 1, `${box.width}x${box.height}`);
  await shot("f1-featured");

  // A category.
  const cat = col[3];
  await (await section(`cat:${cat}`)).click();
  await win.waitForTimeout(400);
  const inCat = await tiles();
  check("a category shows only its filters under its name", inCat.length > 0 && inCat.every((t) => t.category === cat) && (await win.locator("[data-testid=filters-heading]").innerText()) === cat, `${cat}: ${inCat.length}`);
  await (await section("all")).click();

  // The search, and one that matches nothing.
  const search = win.locator("[data-testid=filters-search]");
  const word = (all.find((t) => /^[A-Za-z]{4,}/.test(t.name))?.name ?? "warm").split(" ")[0].toLowerCase();
  await search.fill(word);
  await win.waitForTimeout(400);
  const found = await tiles();
  check("the search keeps the filters whose name or category has the word", found.length > 0 && found.length < all.length && found.every((t) => `${t.name} ${t.category}`.toLowerCase().includes(word)), `"${word}": ${found.length}`);
  await search.fill("zzqvx-no-filter-987654");
  await win.waitForTimeout(400);
  check("a search with no match says so and shows no tiles", (await tiles()).length === 0 && (await win.locator("[data-testid=filters-empty]").count()) === 1, await win.locator("[data-testid=filters-empty]").innerText().catch(() => "none"));
  await shot("f2-unmatched-search-results");
  await win.locator("[data-testid=filters-search-clear]").click();
  check("the field's × clears the search", (await search.inputValue()) === "" && (await tiles()).length === all.length);

  // Favorites: empty, then a filter's star.
  await (await section("favorites")).click();
  await win.waitForTimeout(300);
  check("Favorites starts empty with a note", (await tiles()).length === 0 && (await win.locator("[data-testid=filters-empty]").count()) === 1);
  await (await section("all")).click();
  await win.waitForTimeout(300);
  const first = win.locator("[data-testid=filter-tile]").first();
  const firstId = await first.getAttribute("data-filter");
  await first.hover();
  await shot("f4-item-hover");
  check("hovering a tile shows its star and +", (await first.locator("[data-testid=filter-favourite]").count()) === 1 && (await first.locator("[data-testid=filter-add]").count()) === 1);
  await first.locator("[data-testid=filter-favourite]").click();
  await win.waitForTimeout(200);
  await (await section("favorites")).click();
  await win.waitForTimeout(300);
  const fav = await tiles();
  check("a starred filter is under Favorites", fav.length === 1 && fav[0].id === firstId, fav.map((t) => t.id).join(","));
  await shot("f3-favorites");
  await win.locator("[data-testid=filter-tile]").first().hover();
  await win.locator("[data-testid=filter-favourite]").first().click();
  await win.waitForTimeout(300);
  check("its star again takes it out", (await tiles()).length === 0);
  await (await section("all")).click();
  await win.waitForTimeout(300);

  // A click previews: the player shows the filter, the project doesn't have it.
  const tile = win.locator("[data-testid=filter-tile]").nth(3);
  await settled(win, () => tile.click());
  const previewed = (await engineFrame(win)).sum;
  check("a click previews the filter in the player", previewed !== f0 && (await tile.getAttribute("aria-pressed")) === "true", `frame changed ${previewed !== f0}, pressed ${await tile.getAttribute("aria-pressed")}`);
  check("and adds nothing to the saved project", (await filtersIn()).length === n0, `${n0} → ${(await filtersIn()).length}`);
  await settled(win, () => tile.click());
  check("a second click puts the player back", (await engineFrame(win)).sum === f0 && (await tile.getAttribute("aria-pressed")) === "false");

  // + adds a filter clip at the playhead.
  const target = win.locator("[data-testid=filter-tile]").nth(3);
  const targetId = await target.getAttribute("data-filter");
  await undoCase(ctx, check, "add filter", async () => {
    await target.hover();
    await settled(win, () => target.locator("[data-testid=filter-add]").click());
  });
  const clips = await filtersIn();
  const clip = clips.find((c) => c.name && c.smallPath?.includes(targetId));
  check("+ puts a filter clip at the playhead", clips.length === n0 + 1 && !!clip && Math.abs(+clip.startTick / 1e6 - 2) < 0.05, clip ? `${clip.name} at ${+clip.startTick / 1e6}s` : "none");
  check("and the engine's frame changes", (await engineFrame(win)).sum !== f0);
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  check("the clip is selected on its Filters tab", tabs.startsWith("Filters"), tabs);
  await shot("f6-inspector");

  // Intensity.
  const nameShown = await win.locator("[data-testid=filter-name]").innerText().catch(() => "");
  check("the inspector shows the filter's Name", nameShown === clip?.name, nameShown);
  const before = (await engineFrame(win)).sum;
  await undoCase(ctx, check, "intensity", () => typeInto(win, "Intensity", 30));
  const after = (await filtersIn()).find((c) => c.name === clip?.name);
  check("Intensity 30 is saved and changes the frame", after?.intensity === 30 && (await engineFrame(win)).sum !== before, `${after?.intensity}`);
  check("the keyframe diamond is there", (await win.locator("[data-testid=inspector] [data-keyframe=intensity]").count()) === 1);
  return report();
};
