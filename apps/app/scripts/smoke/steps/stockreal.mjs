// The Media tab's Library against the real services, by hand (after `import timeline`; no fixture
// server, so it needs the network): the real Trending list, a search, Photos, a real video and
// a real photo added at the playhead, and the credits. Not part of the automated runs.
// Shots: `r1-library` ↔ `05-left-media/023-library-default`, `r2-photos`, `r3-added`, `r4-credits`.
import { engineFrame, rulerMap, seek, sectionButton } from "./_preview.mjs";
import { checks, clipsWhere, savedProject } from "./_anim.mjs";

export default async (ctx) => {
  const { check, report } = checks();
  const win = ctx.win;
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 1);
  await win.locator("[data-testid=assets-tab-media]").click();
  await (await sectionButton(win, "library:trending")).click();
  await win.waitForSelector("[data-testid=stock-tile]", { timeout: 60000 });
  await win.waitForTimeout(3000);
  const tiles = await win.evaluate(() => [...document.querySelectorAll("[data-testid=stock-tile]")].map((t) => `${t.dataset.source}|${t.dataset.license}|${t.getAttribute("aria-label")}`));
  check("the real Trending list has videos", tiles.length >= 6, `${tiles.length}: ${tiles.slice(0, 4).join(" ; ")}`);
  await ctx.shot("r1-library");
  await win.locator("[data-testid=stock-search]").fill("ocean waves");
  await win.waitForTimeout(4000);
  const found = await win.locator("[data-testid=stock-tile]").count();
  check("a search finds videos", found > 0, `${found}`);
  await win.locator("[data-testid=stock-kind]").click();
  await win.locator("[data-testid=stock-kind-photo]").click();
  await win.waitForTimeout(5000);
  const photos = await win.evaluate(() => [...document.querySelectorAll("[data-testid=stock-tile]")].map((t) => `${t.dataset.source}|${t.dataset.license}`));
  check("Photos lists pictures from more than one source", photos.length > 3 && new Set(photos.map((p) => p.split("|")[0])).size >= 2, JSON.stringify(photos));
  await ctx.shot("r2-photos");
  const before = (await engineFrame(win)).sum;
  const photo = win.locator("[data-testid=stock-tile]").first();
  await photo.hover();
  await photo.locator("[data-testid=stock-add]").click();
  await win.waitForFunction(() => document.querySelectorAll("[data-testid=stock-spinner]").length === 0, null, { timeout: 90000 });
  await win.waitForTimeout(2500);
  let d = await savedProject(win, ctx.udDir);
  const credited = Object.values(d.assets).filter((a) => a.credit);
  check("the photo is on the timeline with its credit", clipsWhere(d, (c) => c.type === "image").length >= 1 && credited.length === 1 && !!credited[0].credit.license && !!credited[0].credit.sourceUrl, JSON.stringify(credited.map((a) => a.credit)));
  await seek(win, ctx.map, 1);
  check("the engine's frame changed", (await engineFrame(win)).sum !== before);
  await win.locator("[data-testid=stock-kind]").click();
  await win.locator("[data-testid=stock-kind-video]").click();
  await win.waitForTimeout(4000);
  const video = win.locator("[data-testid=stock-tile][data-source=commons]").first();
  await video.hover();
  await video.locator("[data-testid=stock-add]").click();
  await win.waitForFunction(() => document.querySelectorAll("[data-testid=stock-spinner]").length === 0, null, { timeout: 180000 });
  await win.waitForTimeout(4000);
  d = await savedProject(win, ctx.udDir);
  check("the video is on the timeline with its credit", clipsWhere(d, (c) => c.type === "video").length >= 2 && Object.values(d.assets).filter((a) => a.credit).length === 2, JSON.stringify(Object.values(d.assets).map((a) => a.credit?.title)));
  await ctx.shot("r3-added");
  await (await sectionButton(win, "library:credits")).click();
  await win.waitForTimeout(500);
  check("two credit rows", (await win.locator("[data-testid=credit-row]").count()) === 2);
  await ctx.shot("r4-credits");
  return report();
};
