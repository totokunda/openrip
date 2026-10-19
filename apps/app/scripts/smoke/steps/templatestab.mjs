// The editor's Templates tab (after `import timeline newtext`; `CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1`,
// built app, no dev server): the empty state with how to save a template; Project 1 (the clip and
// the text) saved as a template from Home; in a second, empty project the tab lists it as a tall
// card (cover, "2 clips | 00:12", name), the column's shape sections and the search; a click previews
// it in the player without changing the project; "Use" lays its clips in at the playhead (the
// project takes its canvas, the engine draws the video, the media is copied into the project's
// own folder) as one undo step, redone, saved and restored by a restart's reopen; used again at 3 s
// in the same project (the same media reused, a second copy of the clips, one undo step); and
// "New" starting a new project from it.
// Shots: `t1-empty` ↔ `14-left-templates/001-editor-templates-default` (empty), `t2-tab` ↔ `001`,
// `t3-preview`, `t4-used`.
import path from "node:path";
import { goHome, engineFrame, previewRect, rulerMap, seek, sectionButton } from "./_preview.mjs";
import { checks, clipsWhere, savedProject } from "./_anim.mjs";
import { press, state, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, shot, fs, udDir } = ctx;
  const { check, report } = checks();
  const dir = path.join(udDir, "projects-json");
  const doc = () => savedProject(ctx.win, udDir);
  const open = async () => {
    await win.locator("[data-testid=assets-tab-templates]").click();
    await win.waitForTimeout(800);
  };

  // ---- Empty: how to save one -----------------------------------------------------------------------
  const d0 = await doc();
  const sourceClips = d0.timeline.clips.length;
  await open();
  check("the tab has its column: Templates with Your templates and the shapes", (await (await sectionButton(win, "all")).innerText()) === "Your templates" && (await (await sectionButton(win, "square")).count()) === 1);
  check("with no template saved, it explains how to save one", /Save as template/.test(await win.locator("[data-testid=tpltab-empty]").innerText()) && /Home/.test(await win.locator("[data-testid=tpltab-empty]").innerText()));
  await shot("t1-empty");

  // ---- Save Project 1 as a template from Home ---------------------------------------------------------
  await goHome(win);
  await win.waitForTimeout(800);
  const card1 = win.locator("[data-testid=project-card][data-project-id='1']");
  await card1.hover();
  await card1.locator("button[aria-label^='More for']").click();
  await win.locator("[data-testid=project-save-template]").click();
  await win.waitForTimeout(2500);
  const tdirs = fs.existsSync(path.join(dir, "templates")) ? fs.readdirSync(path.join(dir, "templates")) : [];
  check("Project 1 is saved as a template", tdirs.length === 1);
  const tplDoc = JSON.parse(fs.readFileSync(path.join(dir, "templates", tdirs[0], "project.json"), "utf8"));
  check("with its video and its text", tplDoc.timeline.clips.length === sourceClips && sourceClips >= 2 && tplDoc.timeline.clips.some((c) => c.type === "text"), `${sourceClips}`);

  // ---- A second, empty project ---------------------------------------------------------------------------
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(2500);
  check("the second project is empty", (await doc()).timeline.clips.length === 0);
  await open();
  const cards = win.locator("[data-testid=tpltab-card]");
  check("the tab lists the template", (await cards.count()) === 1);
  const text = (await cards.first().innerText()).replace(/\n/g, " / ");
  check("its clip count and length under the cover, then its name", new RegExp(`${sourceClips} clips \\| 00:1[12]`).test(text) && (await win.locator("[data-testid=tpltab-name]").innerText()).length > 0, text);
  check("with its cover", (await cards.first().locator("img").count()) === 1);
  const geo = await win.evaluate(() => {
    const t = document.querySelector("[data-testid=tpltab-tile]").getBoundingClientRect();
    return { w: Math.round(t.width), h: Math.round(t.height) };
  });
  check("a tall card", geo.h > geo.w * 1.3, JSON.stringify(geo));
  await shot("t2-tab");
  // The search and the shape sections.
  await win.locator("[data-testid=tpltab-search]").fill("zzzz");
  await win.waitForTimeout(300);
  check("a search matching nothing says so", (await cards.count()) === 0 && (await win.locator("[data-testid=tpltab-none]").count()) === 1);
  await win.locator("[data-testid=tpltab-search]").fill("");
  const ar = tplDoc.settings.aspectRatio;
  const own = ar.width === ar.height ? "square" : ar.width > ar.height ? "landscape" : "portrait";
  const other = own === "portrait" ? "landscape" : "portrait";
  await (await sectionButton(win, other)).click();
  await win.waitForTimeout(400);
  check(`${other} hides a ${own} template`, (await cards.count()) === 0);
  await (await sectionButton(win, own)).click();
  await win.waitForTimeout(400);
  check(`${own} lists it`, (await cards.count()) === 1);

  // ---- A click previews it ---------------------------------------------------------------------------------
  const clips0 = JSON.stringify((await doc()).timeline.clips);
  const player = await previewRect(win);
  const still = () => win.screenshot({ clip: { x: player.x, y: player.y, width: player.w, height: player.h } });
  const before = await still();
  const tile = win.locator("[data-testid=tpltab-tile]").first();
  await tile.click();
  await win.waitForTimeout(900);
  check("a click previews it (the card is marked)", (await tile.getAttribute("aria-pressed")) === "true");
  check("the player shows it", !before.equals(await still()));
  check("and changes nothing in the project", JSON.stringify((await doc()).timeline.clips) === clips0);
  await shot("t3-preview");
  await tile.click();
  await win.waitForTimeout(400);
  check("a second click puts the preview away", (await tile.getAttribute("aria-pressed")) === "false");

  // ---- Use: clips in at the playhead, one undo step -----------------------------------------------------------------
  const use = async () => {
    await win.mouse.move(5, 5);
    await tile.hover();
    await win.locator("[data-testid=tpltab-use]").first().click();
    await win.waitForTimeout(3500);
  };
  await undoCase(ctx, check, "use the template in an empty project", use);
  ctx.map = await rulerMap(win);
  let d = await doc();
  check("its clips are in the project", d.timeline.clips.length === sourceClips, `${d.timeline.clips.length}`);
  check("fresh ids, not the template's", d.timeline.clips.every((c) => !tplDoc.timeline.clips.some((t) => t.clipId === c.clipId)));
  check("the project took the template's canvas", d.settings.aspectRatio.width === ar.width && d.settings.aspectRatio.height === ar.height, JSON.stringify(d.settings.aspectRatio));
  const types = (x) => x.timeline.clips.map((c) => c.type).sort().join();
  check("the same kinds of clips on their own tracks", types(d) === types(tplDoc) && d.timeline.tracks.length === tplDoc.timeline.tracks.length, `${types(d)} | ${d.timeline.tracks.map((t) => t.type)}`);
  check("the media came with it, into this project's own folder", Object.values(d.assets).every((a) => a.path.includes(`/media/${d.meta.id}/`) && !a.path.includes("tpl-")), JSON.stringify(Object.values(d.assets).map((a) => a.path)));
  check("and the files are there", Object.values(d.assets).every((a) => fs.existsSync(decodeURIComponent(new URL(a.path).pathname))));
  await seek(win, ctx.map, 1);
  await win.waitForTimeout(800);
  check("the engine draws the video", (await engineFrame(win, "r + g + b > 60")).count > 2000);
  await shot("t4-used");

  // ---- Used again at 3 s: a second copy, the media reused ---------------------------------------------------------------
  await seek(win, ctx.map, 3);
  const first = d;
  await undoCase(ctx, check, "use it again at 3 s", use);
  d = await doc();
  check("a second copy of the clips", d.timeline.clips.length === sourceClips * 2, `${d.timeline.clips.length}`);
  const text2 = clipsWhere(d, (c) => c.type === "text");
  check("its text starts at the playhead, 3 s later than the first", text2.length === 2 && Math.abs(+text2[1].startTick - +text2[0].startTick - 3e6) < 0.1e6, text2.map((c) => c.startTick).join());
  check("the same file is one asset, not two", Object.keys(d.assets).length === Object.keys(first.assets).length, `${Object.keys(d.assets).length}`);
  check("every clip has its own id", new Set(d.timeline.clips.map((c) => c.clipId)).size === d.timeline.clips.length);

  // ---- It's saved: the project reopened has the clips ----------------------------------------------------------------------
  await state(ctx, Date.now() - 400);
  const saved = (await doc()).timeline.clips.length;
  await ctx.relaunch();
  const { openEditor } = await import("./_preview.mjs");
  await openEditor(ctx.win);
  await ctx.win.waitForTimeout(2500);
  d = await savedProject(ctx.win, udDir);
  check("after a restart the project still has the template's clips", d.timeline.clips.length === saved && saved === sourceClips * 2, `${d.timeline.clips.length}`);
  ctx.map = await rulerMap(ctx.win);
  await seek(ctx.win, ctx.map, 1);
  await ctx.win.waitForTimeout(800);
  check("and the engine draws them", (await engineFrame(ctx.win, "r + g + b > 60")).count > 2000);

  // ---- "New" starts a project from it -----------------------------------------------------------------------------------------
  const projects = () => fs.readdirSync(dir).filter((f) => /^project-\d+\.json$/.test(f)).length;
  const n0 = projects();
  await ctx.win.locator("[data-testid=assets-tab-templates]").click();
  await ctx.win.waitForTimeout(800);
  const tile2 = ctx.win.locator("[data-testid=tpltab-tile]").first();
  await tile2.hover();
  await ctx.win.locator("[data-testid=tpltab-new]").first().click();
  await ctx.win.waitForTimeout(6000);
  check("New made another project, open in the editor", projects() === n0 + 1 && (await ctx.win.locator("[data-testid=editor]").count()) === 1, `${n0} -> ${projects()}`);
  const made = await savedProject(ctx.win, udDir);
  check("with the template's clips", made.timeline.clips.length === sourceClips, `${made.timeline.clips.length}`);
  void press;
  return report();
};
