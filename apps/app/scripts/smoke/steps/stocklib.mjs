// The Media tab's stock Library (after `import timeline`; `CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1`,
// built app, no dev server), against a local fixture server standing in for the three services
// (OPENRIP_STOCK_MIRROR; steps/_stockfixture.mjs): the column (Favorites, the categories under
// Library, Credits) and its two-column tiles with length, licence chip and download mark; each
// category and a typed search being a search of the services (and answers kept, not asked twice);
// the Videos / Photos switch; what's left out (Share-Alike, NonCommercial, Restrictions, mature);
// a tile's hover preview and a click previewing in the player without changing the project; "+"
// downloading (a spinner) and adding a WebM and a photo at the playhead, in one undo step each,
// the engine's frame changing, the file in the app data and the asset keeping its licence, author
// and source; a NASA MP4 through its asset manifest; favourites; a tile dragged onto the timeline;
// the credits view and its copied text; and the clean offline message with Try again.
// Shots: `g1-library` ↔ `05-left-media/023-library-default`, `g2-preview`, `g3-photos` ↔ `…/034` (the
// type menu's neighbour), `g4-credits`, `g5-offline`.
import path from "node:path";
import { drag, engineFrame, previewRect, rulerMap, seek, settled, timelineRect } from "./_preview.mjs";
import { checks, clipsWhere, savedProject } from "./_anim.mjs";
import { press, state, undoCase } from "./_undo.mjs";
import { fixtureServer, makeMedia } from "./_stockfixture.mjs";

export default async (ctx) => {
  const media = makeMedia(path.join(ctx.outDir, "stock-fixtures"), ctx.fs);
  const server = await fixtureServer(media, ctx.fs);
  try {
    return await run(ctx, server);
  } finally {
    await server.stop();
  }
};

const run = async (ctx, server) => {
  const { check, report } = checks();
  process.env.OPENRIP_STOCK_MIRROR = server.url;
  await ctx.relaunch();
  const win = ctx.win;
  const { shot, udDir } = ctx;
  const { openEditor } = await import("./_preview.mjs");
  await openEditor(win);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 1);
  const doc = () => savedProject(ctx.win, udDir);
  const tiles = () =>
    win.evaluate(() =>
      [...document.querySelectorAll("[data-testid=stock-tile]")].map((t) => ({ id: t.dataset.stock, kind: t.dataset.kind, source: t.dataset.source, license: t.dataset.license, title: t.getAttribute("aria-label"), ready: t.dataset.ready, text: t.innerText.replace(/\s+/g, " ").trim() })),
    );
  const searches = () => server.hits.filter((h) => /gsrsearch|\/v1\/images|\/nasa\/search/.test(h)).map((h) => decodeURIComponent(h.replace(/\+/g, " ")));
  const section = async (id) => {
    await win.locator(`[data-testid='assets-section-${id}']`).click();
    await win.waitForTimeout(900);
  };
  const waitTiles = (n = 1) => win.waitForFunction((n) => document.querySelectorAll("[data-testid=stock-tile]").length >= n, n, { timeout: 15000 });
  const chooseKind = async (k) => {
    await win.locator("[data-testid=stock-kind]").click();
    await win.locator(`[data-testid=stock-kind-${k}]`).click();
    await win.waitForTimeout(900);
  };

  // ---- The column and the first list ------------------------------------------------------------
  await win.locator("[data-testid=assets-tab-media]").click();
  const names = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=assets-section-]")].map((b) => b.innerText.trim()));
  check("the column: Media under Import, then Library with Favorites, the categories and Credits", names[0] === "Media" && names[1] === "Favorites" && names[2] === "Trending" && ["Green Screen", "Background", "Scenery", "Atmosphere", "Life"].every((n) => names.includes(n)) && names[names.length - 1] === "Credits", JSON.stringify(names));
  await section("library:trending");
  await waitTiles(3);
  let list = await tiles();
  check("Trending lists videos from Commons and NASA, in two columns", list.length === 3 && list.every((t) => t.kind === "video") && new Set(list.map((t) => t.source)).size === 2, JSON.stringify(list.map((t) => `${t.source}:${t.title}`)));
  check("Share-Alike and Restrictions files are left out", !list.some((t) => /sharealike|restricted/i.test(t.title)), JSON.stringify(list.map((t) => t.title)));
  check("each tile shows its licence", list.every((t) => /CC0|CC BY|NASA/.test(t.text)), JSON.stringify(list.map((t) => t.text)));
  check("a Commons video shows its length", list.find((t) => t.source === "commons").text.includes("00:02"));
  const geo = await win.evaluate(() => {
    const r = [...document.querySelectorAll("[data-testid=stock-tile]")].map((t) => t.getBoundingClientRect());
    return { cols: new Set(r.map((x) => Math.round(x.x))).size, w: Math.round(r[0].width) };
  });
  check("two columns of tiles", geo.cols === 2 && geo.w > 100, JSON.stringify(geo));
  check("it opens on Trending", (await win.locator("[data-testid=stock-heading]").innerText()) === "Trending");
  check("the services were asked with the app's name", server.agents.length > 0 && server.agents.filter(([p]) => !p.startsWith("/files")).every(([, ua]) => /^OpenRip\//.test(ua)), JSON.stringify(server.agents.slice(0, 2)));
  await shot("g1-library");

  // ---- Categories are searches; answers are kept ---------------------------------------------------
  const n0 = searches().length;
  await section("library:green-screen");
  await waitTiles(2);
  check("a category searches for its words", searches().slice(n0).some((s) => /green screen filetype:video/.test(s)), JSON.stringify(searches().slice(n0)));
  check("with its name as the heading", (await win.locator("[data-testid=stock-heading]").innerText()) === "Green Screen");
  const n1 = server.hits.length;
  await section("library:trending");
  await waitTiles(3);
  check("an answer already had isn't asked for again", server.hits.length === n1);
  await win.locator("[data-testid=stock-search]").fill("waterfall");
  await win.waitForFunction(() => [...document.querySelectorAll("[data-testid=stock-tile]")].some((t) => /waterfall/i.test(t.getAttribute("aria-label"))), null, { timeout: 15000 });
  list = await tiles();
  check("a typed search finds videos by its words, over every category", list.length === 3 && list.every((t) => /waterfall/i.test(t.title)), JSON.stringify(list.map((t) => t.title)));
  await win.locator("[data-testid=stock-search]").fill("zzempty");
  await win.waitForTimeout(1200);
  check("a search finding nothing says so", /No videos found/.test(await win.locator("[data-testid=stock-empty]").innerText()));
  await win.locator("[data-testid=stock-search-clear]").click();
  await win.waitForTimeout(800);

  // ---- Videos / Photos -----------------------------------------------------------------------------------
  const nPhotos = server.hits.length;
  await chooseKind("photo");
  await waitTiles(4);
  list = await tiles();
  check("Photos lists pictures from Openverse, Commons and NASA", list.every((t) => t.kind === "photo") && ["openverse", "commons", "nasa"].every((s) => list.some((t) => t.source === s)), JSON.stringify(list.map((t) => `${t.source}:${t.license}`)));
  check("NonCommercial, Share-Alike and mature pictures are left out", !list.some((t) => /sharealike|restricted/i.test(t.title) || / photo [345]$/.test(t.title)) && list.every((t) => /^(CC0|CC BY 2\.0|CC BY 4\.0|NASA)/.test(t.license)), JSON.stringify(list.map((t) => `${t.title}|${t.license}`)));
  const ov = server.hits.slice(nPhotos).find((h) => h.includes("/v1/images/")) ?? "";
  check("Openverse is asked for CC0, public domain and CC BY only", decodeURIComponent(ov).includes("license=cc0,pdm,by") && ov.includes("mature=false"), ov);
  check("the placeholder in the search shows Photos", (await win.locator("[data-testid=stock-search]").getAttribute("placeholder")) === "Search photos" && (await win.locator("[data-testid=stock-kind-label]").innerText()) === "Photos");
  await shot("g3-photos");
  await chooseKind("video");
  await waitTiles(3);

  // ---- Hover and click preview --------------------------------------------------------------------------------
  const clips0 = JSON.stringify((await doc()).timeline.clips.map((c) => c.clipId));
  const first = win.locator("[data-testid=stock-tile][data-source=commons]").first();
  await win.mouse.move(5, 5);
  await first.hover();
  await win.waitForSelector("[data-testid=stock-hover-video]", { timeout: 5000 });
  check("a hovered video plays on its tile", (await first.locator("video").count()) === 1);
  check("hovering shows a star and \"+\"", (await first.locator("[data-testid=stock-favourite]").count()) === 1 && (await first.locator("[data-testid=stock-add]").count()) === 1);
  const player = await previewRect(win);
  const still = () => win.screenshot({ clip: { x: player.x, y: player.y, width: player.w, height: player.h } });
  const before = await still();
  await first.click();
  await win.waitForTimeout(3500);
  check("a click previews it (the tile is marked)", (await first.getAttribute("aria-pressed")) === "true");
  const after = await still();
  check("the player shows it", !before.equals(after), `${before.length} ${after.length}`);
  check("and adds nothing", JSON.stringify((await doc()).timeline.clips.map((c) => c.clipId)) === clips0);
  await shot("g2-preview");
  await first.click();
  await win.waitForTimeout(500);
  check("a second click puts the preview away", (await first.getAttribute("aria-pressed")) === "false");

  // ---- "+" adds a WebM: downloaded, imported, one undo step ----------------------------------------------------------
  const videoTile = win.locator("[data-testid=stock-tile][data-source=commons][data-license=CC0]").first();
  const videoId = await videoTile.getAttribute("data-stock");
  let sawSpinner = false;
  const addVideo = async () => {
    await win.mouse.move(5, 5);
    await videoTile.hover();
    await videoTile.locator("[data-testid=stock-add]").click();
    await win.waitForTimeout(350);
    sawSpinner = (await videoTile.locator("[data-testid=stock-spinner]").count()) === 1;
    await win.waitForFunction((id) => document.querySelector(`[data-stock="${id}"]`)?.dataset.ready === "1", videoId, { timeout: 20000 });
    await win.waitForTimeout(1500);
  };
  await undoCase(ctx, check, "add a stock video", addVideo);
  check("a spinner showed on the tile while it downloaded", sawSpinner);
  let d = await doc();
  const vids = clipsWhere(d, (c) => c.type === "video");
  const added = vids.find((c) => d.assets[c.assetId]?.credit);
  check("a second video clip is on the main track, in at the playhead's cut", vids.length === 2 && !!added && +added.startTick === 0, JSON.stringify(vids.map((c) => [c.startTick, c.endTick])));
  check("its length is the file's (2 s)", !!added && Math.abs((+added.endTick - +added.startTick) / 1e6 - 2) < 0.1, added && `${added.endTick}`);
  const asset = added && d.assets[added.assetId];
  check("the file is in the app data", !!asset && ctx.fs.readdirSync(`${udDir}/stock`).some((f) => f.startsWith(videoId) && f.endsWith(".webm")), ctx.fs.existsSync(`${udDir}/stock`) ? ctx.fs.readdirSync(`${udDir}/stock`).join(",") : "no folder");
  check("the asset keeps its licence, author and source", !!asset?.credit && asset.credit.license === "CC0" && /Fixture Author/.test(asset.credit.author) && asset.credit.sourceName === "Wikimedia Commons" && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(asset.credit.sourceUrl) && asset.credit.attributionRequired === false && asset.credit.kind === "video", JSON.stringify(asset?.credit));
  await seek(win, ctx.map, 1);
  const frame1 = (await engineFrame(win)).sum;
  await shot("g2b-added");

  // ---- A photo from Openverse (CC BY): credit required --------------------------------------------------------------------
  await chooseKind("photo");
  await waitTiles(4);
  const photoTile = win.locator("[data-testid=stock-tile][data-source=openverse][data-license='CC BY 2.0']").first();
  const photoId = await photoTile.getAttribute("data-stock");
  await seek(win, ctx.map, 5);
  await undoCase(ctx, check, "add a stock photo", async () => {
    await win.mouse.move(5, 5);
    await photoTile.hover();
    await photoTile.locator("[data-testid=stock-add]").click();
    await win.waitForFunction((id) => document.querySelector(`[data-stock="${id}"]`)?.dataset.ready === "1", photoId, { timeout: 20000 });
    await win.waitForTimeout(1500);
  });
  d = await doc();
  const imgs = clipsWhere(d, (c) => c.type === "image");
  const pAsset = imgs[0] && d.assets[imgs[0].assetId];
  check("a photo clip (the default image length) with its credit", imgs.length === 1 && Math.abs((+imgs[0].endTick - +imgs[0].startTick) / 1e6 - 5) < 0.1 && pAsset?.credit?.license === "CC BY 2.0" && pAsset.credit.attributionRequired === true && pAsset.credit.author === "Photographer 1" && pAsset.credit.sourceName === "Openverse", JSON.stringify(pAsset?.credit));
  check("the photo's file is a JPEG in the app data", ctx.fs.readdirSync(`${udDir}/stock`).some((f) => f.startsWith(photoId) && f.endsWith(".jpg")));
  await seek(win, ctx.map, 1);
  check("the frame is unchanged where the photo isn't", (await engineFrame(win)).sum === frame1);

  // ---- NASA's MP4 through its asset manifest -----------------------------------------------------------------------------------
  await chooseKind("video");
  await waitTiles(3);
  const nasa = win.locator("[data-testid=stock-tile][data-source=nasa]").first();
  const nasaId = await nasa.getAttribute("data-stock");
  await win.mouse.move(5, 5);
  await nasa.hover();
  await nasa.locator("[data-testid=stock-download]").click();
  await win.waitForFunction((id) => document.querySelector(`[data-stock="${id}"]`)?.dataset.ready === "1", nasaId, { timeout: 20000 });
  check("a NASA video is downloaded by its manifest (an MP4)", ctx.fs.readdirSync(`${udDir}/stock`).some((f) => f.startsWith(nasaId) && f.endsWith(".mp4")) && server.hits.some((h) => h.startsWith("/nasa/asset/FIXTURE_VIDEO_1")), server.hits.filter((h) => h.includes("nasa")).join(" "));

  // ---- Favourites ---------------------------------------------------------------------------------------------------------------
  const fav = win.locator("[data-testid=stock-tile]").nth(1);
  const favId = await fav.getAttribute("data-stock");
  await win.mouse.move(5, 5);
  await fav.hover();
  await fav.locator("[data-testid=stock-favourite]").click();
  await section("library:favorites");
  list = await tiles();
  check("a starred video is under Favorites", list.length === 1 && list[0].id === favId, JSON.stringify(list.map((t) => t.id)));
  await chooseKind("photo");
  check("Favorites is per kind (no photos starred)", /No favorite photos yet/.test(await win.locator("[data-testid=stock-empty]").innerText()));
  await chooseKind("video");
  const stored = await win.evaluate(() => JSON.parse(localStorage.getItem("openrip.stock-favorites") ?? "[]").map((x) => [x.id, x.license, x.sourceUrl]));
  check("a favourite keeps its licence and source (it works offline)", stored.length === 1 && !!stored[0][1] && /^https:/.test(stored[0][2]), JSON.stringify(stored));
  await win.mouse.move(5, 5);
  await win.locator("[data-testid=stock-tile]").first().hover();
  await win.locator("[data-testid=stock-favourite]").click();
  await win.waitForTimeout(300);
  check("un-starring empties it, with its note", /No favorite videos yet/.test(await win.locator("[data-testid=stock-empty]").innerText()));

  // ---- Credits -----------------------------------------------------------------------------------------------------------------------
  await section("library:credits");
  const rows = await win.evaluate(() => [...document.querySelectorAll("[data-testid=credit-row]")].map((r) => ({ kind: r.dataset.kind, required: r.dataset.required, text: r.innerText.replace(/\s+/g, " ") })));
  check("the credits view lists both assets, the CC BY one marked", rows.length === 2 && rows.some((r) => r.kind === "photo" && r.required === "1" && /Credit needed/.test(r.text) && /Photographer 1/.test(r.text) && /CC BY 2\.0/.test(r.text)) && rows.some((r) => r.kind === "video" && r.required === "0" && /No credit needed/.test(r.text)), JSON.stringify(rows));
  check("with its summary", (await win.locator("[data-testid=credits-summary]").innerText()) === "2 openly licensed assets, 1 needs credit.");
  await win.locator("[data-testid=credits-copy]").click();
  await win.waitForTimeout(400);
  const clip = await ctx.app.evaluate(({ clipboard }) => clipboard.readText());
  check("Copy puts the credits text on the clipboard", /^Videos:\n- "Fixture .* one" by Fixture Author 1, CC0/m.test(clip) && /Photos:\n- ".*photo 1" by Photographer 1, CC BY 2\.0 \(https:\/\/creativecommons\.org\/licenses\/by\/2\.0\/\), via Openverse: https:\/\/www\.flickr\.com\/photos\/fixture1\/1/.test(clip), JSON.stringify(clip));
  await win.locator("[data-testid=credits-required]").check();
  await win.locator("[data-testid=credits-copy]").click();
  await win.waitForTimeout(400);
  const need = await ctx.app.evaluate(({ clipboard }) => clipboard.readText());
  check("only the ones that need credit can be copied alone", /Photographer 1/.test(need) && !/Videos:/.test(need), JSON.stringify(need));
  await shot("g4-credits");
  await win.locator("[data-testid=credits-required]").uncheck();

  // ---- Credits follow the project: removing the video's clip drops its credit -------------------------------------------------------------------
  await press(win, "Meta+z");
  await state(ctx, Date.now() - 400);
  await win.waitForTimeout(500);
  const afterUndo = await win.locator("[data-testid=credit-row]").count();
  check("undoing the photo drops its credit from the view", afterUndo === 1, `${afterUndo}`);
  await press(win, "Meta+Shift+z");
  await state(ctx, Date.now() - 400);

  // ---- A tile dragged onto the timeline -------------------------------------------------------------------------------------------------------
  await section("library:trending");
  await waitTiles(3);
  const tl = await timelineRect(win);
  ctx.map = await rulerMap(win);
  const second = await win.locator("[data-testid=stock-tile][data-source=commons]").nth(1).boundingBox();
  const v0 = clipsWhere(await doc(), (c) => c.type === "video").length;
  await settled(win, () => drag(win, second.x + second.width / 2, second.y + second.height / 2, ctx.map.x(9), tl.y + tl.h * 0.35), { timeout: 20000 });
  await win.waitForTimeout(2500);
  d = await doc();
  const dropped = clipsWhere(d, (c) => c.type === "video");
  check("a tile dragged onto the timeline downloads and adds the video", dropped.length === v0 + 1 && dropped.some((c) => d.assets[c.assetId]?.credit?.license === "CC BY 4.0"), `${v0} -> ${dropped.length}`);

  // ---- Offline ---------------------------------------------------------------------------------------------------------------------------------------------
  await server.stop();
  await win.locator("[data-testid=stock-search]").fill("offline probe");
  await win.waitForSelector("[data-testid=stock-error]", { timeout: 15000 });
  const msg = await win.locator("[data-testid=stock-error]").innerText();
  check("offline, the library says so (and offers Try again)", /offline/i.test(msg) && (await win.locator("[data-testid=stock-retry]").count()) === 1, msg);
  check("no tiles and no crash", (await win.locator("[data-testid=stock-tile]").count()) === 0);
  await shot("g5-offline");
  check("what's already in the project and on disk still works offline", (await doc()).timeline.clips.length >= 3);
  await server.restart();
  await win.locator("[data-testid=stock-retry]").click();
  await win.waitForFunction(() => document.querySelectorAll("[data-testid=stock-tile]").length > 0, null, { timeout: 20000 });
  check("Try again finds the library once it's back", (await win.locator("[data-testid=stock-error]").count()) === 0);
  return report();
};
