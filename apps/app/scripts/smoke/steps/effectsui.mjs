// The left panel's Effects tab and the effects it makes (after import timeline; CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, built app, no dev server): its column as CapCut's (Favorites, then Video
// effects with its categories) and 86 px tiles the engine draws (the effect on a sample picture,
// playing when hovered); a category, the search and a search matching nothing; a star and
// Favorites; a click previewing the effect in the player without touching the saved project; + adding
// an effect bar at the playhead on its own track (the engine's frame changes, ⌘Z / ⇧⌘Z); its
// inspector (Name, Intensity and its own parameters, keyframe diamonds), an Intensity keyframe;
// an effect dragged onto a clip and listed in its Adjust tab; the bar trimmed and split; the
// project reopened with the effect still there; and an export whose frames have it (ffmpeg).
// Shots are named after the CapCut references (e1 ↔ 09-left-effects/001-video-effects-trending,
// e2 ↔ 046-unmatched-search-results, e3 ↔ 044-favorites, e4 ↔ 047-classic-item-hover, e6 ↔
// 23-inspector-effect/001-fade-in-basic).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { clickSplit, drag, engineFrame, rulerMap, seek, settled, sectionButton } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { handleX } from "./_timeline.mjs";
import { typeInto, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, udDir, shot, outDir, fs } = ctx;
  const { check, report } = checks();
  const saved = () => savedProject(win, udDir);
  const barsIn = async () => (await saved()).timeline.clips.filter((c) => c.type === "filter" && c.effectId);
  const column = () => win.evaluate(() => [...document.querySelectorAll("nav[aria-label=Sections] button")].map((e) => e.innerText.trim()));
  const tiles = () => win.locator("[data-testid=effect-tile]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-effect"), category: e.getAttribute("data-category"), name: e.title })));
  const section = (id) => sectionButton(win, id);
  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 2);
  const f0 = (await engineFrame(win)).sum;
  const n0 = (await barsIn()).length;

  // The tab and its column.
  await win.locator("[data-testid=assets-tab-effects]").click();
  await win.waitForTimeout(2500);
  const col = await column();
  check("the column: Favorites, Video effects, All, then the categories", col[0] === "Favorites" && col[1] === "Video effects" && col[2] === "All" && col.includes("Glitch") && col.includes("Frames"), col.join(","));
  const all = await tiles();
  check("All lists the effects as tiles, its heading All", all.length >= 60 && (await win.locator("[data-testid=effects-heading]").innerText()) === "All", `${all.length} tiles`);
  const box = await win.locator("[data-testid=effect-tile]").first().boundingBox();
  check("a tile is an 86 px square", Math.abs(box.width - 86) < 1 && Math.abs(box.height - 86) < 1, `${box.width}x${box.height}`);
  // The engine's pictures: each tile's canvas holds the effect drawn on the sample picture.
  const pictures = await win.locator("[data-testid=effect-picture]").evaluateAll((cs) =>
    cs.slice(0, 12).map((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 16) sum = (sum * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007;
      return { sum, lit: d.some((v, i) => i % 4 === 0 && v > 0) };
    }),
  );
  check("the tiles show the engine's frames, each its own", pictures.every((p) => p.lit) && new Set(pictures.map((p) => p.sum)).size > 6, `${new Set(pictures.map((p) => p.sum)).size} distinct of ${pictures.length}`);
  await shot("e1-video-effects");

  // A category.
  const cat = "Glitch";
  await (await section(`cat:${cat}`)).click();
  await win.waitForTimeout(500);
  const inCat = await tiles();
  check("a category shows only its effects under its name", inCat.length > 3 && inCat.every((t) => t.category === cat) && (await win.locator("[data-testid=effects-heading]").innerText()) === cat, `${cat}: ${inCat.length}`);
  await (await section("all")).click();

  // The search, and one that matches nothing.
  const search = win.locator("[data-testid=effects-search]");
  await search.fill("split");
  await win.waitForTimeout(400);
  const found = await tiles();
  check("the search keeps the effects whose name or category has the word", found.length >= 4 && found.length < all.length && found.every((t) => `${t.name} ${t.category}`.toLowerCase().includes("split")), `"split": ${found.length}`);
  await search.fill("zzqvx-no-effect-987654");
  await win.waitForTimeout(400);
  check("a search with no match says so and shows no tiles", (await tiles()).length === 0 && (await win.locator("[data-testid=effects-empty]").count()) === 1);
  await shot("e2-unmatched-search-results");
  await win.locator("[data-testid=effects-search-clear]").click();
  check("the field's × clears the search", (await search.inputValue()) === "" && (await tiles()).length === all.length);

  // Favorites: empty, then an effect's star.
  await (await section("favorites")).click();
  await win.waitForTimeout(300);
  check("Favorites starts empty with a note", (await tiles()).length === 0 && (await win.locator("[data-testid=effects-empty]").count()) === 1);
  await (await section("all")).click();
  await win.waitForTimeout(500);
  const first = win.locator("[data-testid=effect-tile]").first();
  const firstId = await first.getAttribute("data-effect");
  await first.hover();
  await win.waitForTimeout(1200);
  await shot("e4-item-hover");
  check("hovering a tile shows its star and +", (await first.locator("[data-testid=effect-favourite]").count()) === 1 && (await first.locator("[data-testid=effect-add]").count()) === 1);
  await first.locator("[data-testid=effect-favourite]").click();
  await win.waitForTimeout(200);
  await (await section("favorites")).click();
  await win.waitForTimeout(500);
  const fav = await tiles();
  check("a starred effect is under Favorites", fav.length === 1 && fav[0].id === firstId, fav.map((t) => t.id).join(","));
  await shot("e3-favorites");
  await win.locator("[data-testid=effect-tile]").first().hover();
  await win.locator("[data-testid=effect-favourite]").first().click();
  await win.waitForTimeout(300);
  check("its star again takes it out", (await tiles()).length === 0);
  await (await section("all")).click();
  await win.waitForTimeout(500);

  // Hovering plays the effect: the tile's picture changes over time.
  const rot = win.locator("[data-effect=zoom_punch]");
  await rot.hover();
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    await win.waitForTimeout(160);
    seen.add(await rot.locator("canvas").evaluate((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 40) s = (s * 31 + d[i]) % 1000003;
      return s;
    }));
  }
  check("a hovered tile plays the effect", seen.size > 2, `${seen.size} distinct frames`);

  // A click previews: the player shows the effect, the project doesn't have it.
  const tile = win.locator("[data-effect=mono]");
  await tile.scrollIntoViewIfNeeded();
  await settled(win, () => tile.click());
  const previewed = (await engineFrame(win)).sum;
  check("a click previews the effect in the player", previewed !== f0 && (await tile.getAttribute("aria-pressed")) === "true", `frame changed ${previewed !== f0}`);
  check("and adds nothing to the saved project", (await barsIn()).length === n0, `${n0} → ${(await barsIn()).length}`);
  await settled(win, () => tile.click());
  check("a second click puts the player back", (await engineFrame(win)).sum === f0 && (await tile.getAttribute("aria-pressed")) === "false");

  // + adds an effect bar at the playhead.
  const target = win.locator("[data-effect=invert]");
  await target.scrollIntoViewIfNeeded();
  await undoCase(ctx, check, "add effect", async () => {
    await target.hover();
    await settled(win, () => target.locator("[data-testid=effect-add]").click());
  });
  let bars = await barsIn();
  const bar = bars.find((c) => c.effectId === "invert");
  check("+ puts an effect bar at the playhead", bars.length === n0 + 1 && !!bar && Math.abs(+bar.startTick / 1e6 - 2) < 0.05, bar ? `${bar.name} at ${+bar.startTick / 1e6}s` : "none");
  check("and the engine's frame changes", (await engineFrame(win)).sum !== f0);
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  check("the bar is selected on its Special effects tab", tabs.startsWith("Special effects"), tabs);
  await shot("e6-inspector");
  const nameShown = await win.locator("[data-testid=effect-name]").innerText().catch(() => "");
  check("the inspector shows the effect's Name", nameShown === bar?.name, nameShown);
  check("and its Intensity with a keyframe diamond", (await win.locator("[data-testid=inspector] [data-keyframe=intensity]").count()) === 1);

  // Intensity, then a keyframe on it.
  const before = (await engineFrame(win)).sum;
  await undoCase(ctx, check, "intensity", () => typeInto(win, "Intensity", 40));
  const after = (await barsIn()).find((c) => c.effectId === "invert");
  check("Intensity 40 is saved and changes the frame", after?.intensity === 40 && (await engineFrame(win)).sum !== before, `${after?.intensity}`);
  await undoCase(ctx, check, "intensity keyframe", async () => {
    await win.locator("[data-testid=inspector] [data-keyframe=intensity] button").nth(1).click();
  }, { frame: false });
  const keyed = (await barsIn()).find((c) => c.effectId === "invert");
  check("the diamond keys Intensity at the playhead", (keyed?.keyframes?.intensity?.length ?? 0) === 1, JSON.stringify(keyed?.keyframes));

  // An effect dragged onto a clip lands on it, listed in its Adjust tab.
  const rect = await win.locator("[data-effect=mosaic]").boundingBox();
  const video = (await saved()).timeline.clips.find((c) => c.type === "video");
  check("there's a video to drop on", !!video);
  const row = await win.evaluate(() => {
    const canvases = [...document.querySelectorAll("[data-testid=timeline] canvas")].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 400);
    return canvases[0] ? { x: canvases[0].x, y: canvases[0].y, h: canvases[0].height } : null;
  });
  const doc = await saved();
  const vt = doc.timeline.tracks.find((t) => t.timelineId === video.timelineId);
  const dropY = row.y + 27 + vt.timelineY + vt.timelineHeight / 2;
  const dropS = (+video.startTick / 1e6 + +video.endTick / 1e6) / 2;
  await undoCase(ctx, check, "drop effect on clip", async () => {
    await settled(win, () => drag(win, rect.x + 40, rect.y + 40, ctx.map.x(dropS), dropY));
  });
  const withFx = (await saved()).timeline.clips.find((c) => c.clipId === video.clipId);
  check("dropped on a clip, the effect is the clip's own", withFx?.effects?.length === 1 && withFx.effects[0].effectId === "mosaic" && (await barsIn()).length === n0 + 1, JSON.stringify(withFx?.effects));
  const adjustTabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => `${e.innerText.trim()}:${e.getAttribute("data-state")}`).join(","));
  check("its Adjust tab lists the effect", (await win.locator("[data-testid=clip-effect][data-effect=mosaic]").count()) === 1, adjustTabs);
  await shot("e7-clip-effect");
  // Its own keyframe.
  const inst = withFx.effects[0].id;
  await win.locator(`[data-testid=clip-effect][data-instance=${inst}] [data-keyframe='fx:${inst}:intensity']`).scrollIntoViewIfNeeded();
  check("each of its parameters has a diamond", (await win.locator(`[data-testid=clip-effect] [data-keyframe^='fx:${inst}:']`).count()) >= 1);

  // Trim and split the bar: select it, trim its end, split it.
  const bar2 = (await barsIn()).find((c) => c.effectId === "invert");
  const d2 = await saved();
  const bt = d2.timeline.tracks.find((t) => t.timelineId === bar2.timelineId);
  const barY = row.y + 27 + bt.timelineY + bt.timelineHeight / 2;
  const [bs, be] = [+bar2.startTick / 1e6, +bar2.endTick / 1e6];
  await win.mouse.click(ctx.map.x((bs + be) / 2), barY);
  await win.waitForTimeout(400);
  await undoCase(ctx, check, "trim effect bar", async () => {
    const hx = await handleX(win, ctx.map.x(be), barY);
    await settled(win, () => drag(win, hx, barY, ctx.map.x(be - 1.5), barY));
  }, { frame: false });
  const trimmed = (await barsIn()).find((c) => c.clipId === bar2.clipId);
  check("trimmed: the bar is shorter and keeps its effect", +trimmed.endTick / 1e6 < be - 1 && trimmed.effectId === "invert", `${bs}-${be} → ${+trimmed.startTick / 1e6}-${+trimmed.endTick / 1e6}`);
  const mid = (+trimmed.startTick / 1e6 + +trimmed.endTick / 1e6) / 2;
  await seek(win, ctx.map, mid);
  // The split cuts what's selected: the bar, picked where the playhead is.
  await win.mouse.click(ctx.map.x(mid - 0.3), barY);
  await win.waitForTimeout(400);
  await undoCase(ctx, check, "split effect bar", () => settled(win, () => clickSplit(win)), { frame: false });
  const parts = (await barsIn()).filter((c) => c.effectId === "invert").sort((a, b) => +a.startTick - +b.startTick);
  check("split in two bars with the effect, the keyframes divided", parts.length === 2 && parts.every((p) => p.effectId === "invert" && p.keyframes?.intensity?.length >= 1) && Math.abs(+parts[0].endTick - +parts[1].startTick) < 50000, parts.map((c) => `${c.startTick}-${c.endTick}`).join());
  // Move the second part later on the timeline: it stays an effect bar on its own track.
  await seek(win, ctx.map, 2.5);
  await win.waitForTimeout(500);
  await shot("e8-timeline");

  // Reopen: the effects are still there.
  const name = await win.locator("[data-testid=project-name]").inputValue();
  const wanted = (await barsIn()).length;
  await (await import("./reopen.mjs")).default({ win, shot });
  const again = await saved();
  const reBars = again.timeline.clips.filter((c) => c.type === "filter" && c.effectId);
  const reClip = again.timeline.clips.find((c) => c.effects?.length);
  check("reopened, the bars and the clip's effect are there", reBars.length === wanted && reClip?.effects?.[0]?.effectId === "mosaic", `${reBars.length} bars, ${reClip?.effects?.length} on the clip (${name})`);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 2);
  const reFrame = (await engineFrame(win)).sum;
  check("and the engine draws them", reFrame !== f0);

  // Export: the file's frames have the effect.
  await app_exportCheck(ctx, check, shot, outDir, fs);
  return report();
};

// Export the project (with the effects) and compare a frame the bar covers with one it doesn't.
async function app_exportCheck(ctx, check, shot, outDir, fs) {
  const { app, win } = ctx;
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const file = path.join(outDir, "effects-export.mp4");
  fs.rmSync(file, { force: true });
  await win.locator("[data-testid=export]").click();
  await win.waitForTimeout(1000);
  const dialog = win.getByRole("dialog");
  await dialog.locator('input[placeholder="My export"]').fill("effects-export");
  await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  for (let i = 0; i < 240 && !(await win.getByText("Export completed").count()); i++) await win.waitForTimeout(500);
  await shot("x1-exported");
  if (!fs.existsSync(file)) throw new Error("no export file");
  check("exported", true, `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  const ffmpeg = createRequire(path.resolve("../../package.json"))("ffmpeg-static");
  const frame = (s) => {
    const raw = execFileSync(ffmpeg, ["-v", "error", "-ss", String(s), "-i", file, "-frames:v", "1", "-vf", "scale=96:54", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
    return [...raw];
  };
  const doc = await savedProject(win, ctx.udDir);
  const bars = doc.timeline.clips.filter((c) => c.type === "filter" && c.effectId === "invert").sort((a, b) => +a.startTick - +b.startTick);
  const inside = +bars[0].startTick / 1e6 + 0.1;
  const outside = Math.max(0.1, +bars[0].startTick / 1e6 - 0.15);
  const [a, b] = [frame(inside), frame(outside)];
  // Inverted (at 40% and keyed down to nothing at the start): the frame inside differs from the one before it more than neighbouring frames do.
  const diff = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  const still = frame(outside + 0.04).reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  check("the exported frames show the effect bar", diff > still + 1.0, `mean difference ${diff.toFixed(2)} across the bar's start, ${still.toFixed(2)} between neighbours`);
}
