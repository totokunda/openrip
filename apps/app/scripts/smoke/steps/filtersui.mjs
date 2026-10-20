// The left panel's Filters tab (after import timeline): its column as CapCut's (Favorites, then
// Filters with Featured and the look groups: Portrait, Life, Landscape...); each tile is the
// filter's example photo put through its own table (the tile's pixels are compared with the
// plain photo: a Mono filter's are grey, a colour one's differ); a group shows only its
// filters; the search across every group, and a search
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
  const tiles = () => win.locator("[data-testid=filter-tile]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-filter"), category: e.getAttribute("data-group"), name: e.title })));
  const section = (id) => sectionButton(win, id);
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  const f0 = (await engineFrame(win)).sum;
  const n0 = (await filtersIn()).length;

  // The tab and its column.
  await win.locator("[data-testid=assets-tab-filters]").click();
  await win.waitForTimeout(1500);
  const col = await column();
  check("the column: Favorites, Filters, Featured, then the look groups", col[0] === "Favorites" && col[1] === "Filters" && col[2] === "Featured" && ["Portrait", "Landscape", "Movies", "Retro", "Mono", "Night", "Food"].every((g) => col.includes(g)), col.join(","));
  check("no All item: it opens on Featured", !col.includes("All") && (await win.locator("[data-testid=filters-heading]").innerText()) === "Featured");
  const featured = await tiles();
  check("Featured lists the best filters first, by clean names", featured.length >= 12 && featured.length <= 40 && featured[0].name === "Kodak Portra 400 2", `${featured.length} tiles, first ${featured[0]?.name}`);
  const box = await win.locator("[data-testid=filter-tile]").first().boundingBox();
  check("a tile is an 86 px square", Math.abs(box.width - 86) < 1 && Math.abs(box.height - 86) < 1, `${box.width}x${box.height}`);
  await win.waitForFunction(() => [...document.querySelectorAll("[data-testid=filter-tile]")].slice(0, 8).every((e) => e.getAttribute("data-filtered") === "true"), null, { timeout: 15000 }).catch(() => {});
  const px = (sel) =>
    win.locator(sel).evaluateAll(async (els) => {
      const read = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0, 64, 64);
        return x.getImageData(0, 0, 64, 64).data;
      };
      const out = [];
      for (const e of els.slice(0, 40)) {
        const t = await read(e.querySelector("img").src);
        const p = await read(`filter-photos/${e.getAttribute("data-photo")}.webp`);
        let diff = 0, chroma = 0;
        for (let i = 0; i < t.length; i += 4) {
          diff += Math.abs(t[i] - p[i]) + Math.abs(t[i + 1] - p[i + 1]) + Math.abs(t[i + 2] - p[i + 2]);
          chroma += Math.max(t[i], t[i + 1], t[i + 2]) - Math.min(t[i], t[i + 1], t[i + 2]);
        }
        const n = t.length / 4;
        out.push({ id: e.getAttribute("data-filter"), filtered: e.getAttribute("data-filtered"), diff: diff / n / 3, chroma: chroma / n });
      }
      return out;
    });
  const fp = await px("[data-testid=filter-tile]");
  const fdone = fp.filter((t) => t.filtered === "true");
  check("the tiles on screen show their photo through the filter (pixels differ from the plain photo; the rest draw as they scroll in)", fdone.length >= 8 && fdone.every((t) => t.diff > 1.5), fdone.filter((t) => t.diff <= 1.5).map((t) => `${t.id}:${t.diff.toFixed(1)}`).join(",") || `${fdone.length} drawn, mean diff ${(fdone.reduce((a, t) => a + t.diff, 0) / fdone.length).toFixed(1)}`);
  check("the tiles use several example photos", new Set(await win.locator("[data-testid=filter-tile]").evaluateAll((els) => els.map((e) => e.getAttribute("data-photo")))).size >= 5);
  await shot("f1-featured");

  // A group: only its filters, under its name.
  const cat = "Mono";
  await (await section(`cat:${cat}`)).click();
  await win.waitForTimeout(800);
  const inCat = await tiles();
  check("a group shows only its filters under its name", inCat.length > 20 && inCat.every((t) => t.category === cat) && (await win.locator("[data-testid=filters-heading]").innerText()) === cat, `${cat}: ${inCat.length}`);
  await win.waitForFunction(() => [...document.querySelectorAll("[data-testid=filter-tile]")].slice(0, 8).every((e) => e.getAttribute("data-filtered") === "true"), null, { timeout: 15000 }).catch(() => {});
  const mp = await px("[data-testid=filter-tile]");
  const plain = mp.filter((t) => t.filtered === "true");
  check("Mono tiles are grey (the table took the colour out) and differ from the photo", plain.length > 4 && plain.filter((t) => t.chroma < 12).length >= plain.length - 2, plain.slice(0, 6).map((t) => `${t.id}:${t.chroma.toFixed(1)}`).join(","));
  await shot("f1b-mono");
  await (await section("cat:Portrait")).click();
  await win.waitForTimeout(800);
  await win.waitForFunction(() => [...document.querySelectorAll("[data-testid=filter-tile]")].slice(0, 8).every((e) => e.getAttribute("data-filtered") === "true"), null, { timeout: 15000 }).catch(() => {});
  const pp = await px("[data-testid=filter-tile]");
  check("Portrait tiles are colour portraits through their tables", pp.length > 8 && pp.every((t) => t.chroma > 8) && (await win.locator("[data-testid=filter-tile]").evaluateAll((els) => els.every((e) => /^portrait/.test(e.getAttribute("data-photo"))))), pp.slice(0, 4).map((t) => `${t.id}:${t.chroma.toFixed(0)}`).join(","));
  await shot("f1c-portrait");
  await (await section("cat:Featured")).click();
  await win.waitForTimeout(300);
  const all = featured;

  // The search, and one that matches nothing.
  const search = win.locator("[data-testid=filters-search]");
  await search.fill("superia");
  await win.waitForTimeout(500);
  const found = await tiles();
  check("the search looks through every group, not only the open one", found.length > 10 && found.every((t) => /superia/i.test(t.name)) && new Set(found.map((t) => t.category)).size > 2, `"superia": ${found.length} in ${new Set(found.map((t) => t.category)).size} groups`);
  await search.fill("sunset");
  await win.waitForTimeout(500);
  check("a search also matches a group's name", (await tiles()).length > 5);
  await search.fill("zzq");
  await search.fill("zzqvx-no-filter-987654");
  await win.waitForTimeout(400);
  check("a search with no match says so and shows no tiles", (await tiles()).length === 0 && (await win.locator("[data-testid=filters-empty]").count()) === 1, await win.locator("[data-testid=filters-empty]").innerText().catch(() => "none"));
  await shot("f2-unmatched-search-results");
  await win.locator("[data-testid=filters-search-clear]").click();
  check("the field's × clears the search", (await search.inputValue()) === "" && (await tiles()).length === all.length && (await win.locator("[data-testid=filters-heading]").innerText()) === "Featured");

  // Favorites: empty, then a filter's star.
  await (await section("favorites")).click();
  await win.waitForTimeout(300);
  check("Favorites starts empty with a note", (await tiles()).length === 0 && (await win.locator("[data-testid=filters-empty]").count()) === 1);
  await (await section("cat:Featured")).click();
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
  await (await section("cat:Featured")).click();
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
