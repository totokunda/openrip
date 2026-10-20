// Several timelines per project (after `import timeline`; CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1,
// built app, no dev server; FFmpeg from ffmpeg-static makes a photo, ffprobe reads the exports),
// as CapCut's (docs/plan/capcut-ui-spec.md §6.1, §6.5, §6.29 "several timelines per project"):
// - a project from before them has one timeline, "Timeline 01", in the player's title;
// - File > New timeline: an empty "Timeline 02", opened (the engine's frame is black), saved
//   as a second timeline after the first, which stays the file's `timeline`;
// - undo goes per timeline: an edit (a marker) in Timeline 01, undone there, not offered in the new one;
// - the player title's menu switches back: the engine's frame at the playhead is what it was,
//   undo is Timeline 01's again; Rename, Duplicate (fresh ids all through, the copy opened) and
//   Delete (the next one opens; the last one can't go);
// - the media card's "New timeline with selected item": a timeline holding that photo;
// - the Export dialog's Export timeline picks one (the open one by default): the second
//   timeline's file is the photo's length and colour, the first's the video's;
// - the project keeps all of them, their names and which was open, after a restart.
// Shots: `tl1-menu` ↔ `00-menu-bar/008-editor-file-menu`, `tl2-switcher`, `tl3-card-menu` ↔
// `05-left-media/006-media-item-context-menu`, `tl4-export` ↔ `31-dialogs/016-export-video-settings`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { engineFrame, openEditor, rulerMap, seek } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

const FFPROBE = process.env.FFPROBE || "/opt/homebrew/bin/ffprobe";
const probe = (file) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 26 }).toString());

export default async (ctx) => {
  let { win } = ctx;
  const { shot, udDir, outDir, fs, appDir } = ctx;
  const { check, report } = checks();
  const require = createRequire(appDir + "/package.json");
  ctx.map ??= await rulerMap(win);
  const saved = async () => {
    await win.waitForTimeout(1800);
    return savedProject(win, udDir);
  };
  /** The timelines of a saved project, in order, with their clips. */
  const all = (d) => [d.timeline, ...(d.moreTimelines ?? [])];
  const title = () => win.locator("[data-testid=player-title]").innerText();
  const fileMenu = (id) =>
    ctx.app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item) return false;
      item.click();
      return true;
    }, id);
  const openSwitcher = async () => {
    await win.locator("[data-testid=timeline-switcher]").click();
    await win.locator("[data-testid=timeline-menu]").waitFor({ state: "visible" });
  };
  const pickMenu = async (id) => {
    await openSwitcher();
    await win.locator(`[data-testid=${id}]`).click();
    await win.waitForTimeout(1200);
  };
  const names = async () => {
    await openSwitcher();
    const list = await win.locator("[data-testid=timeline-menu] [data-testid^=timeline-item-]").evaluateAll((els) => els.map((e) => ({ name: e.innerText.trim(), active: e.getAttribute("data-active") === "true" })));
    await win.keyboard.press("Escape");
    await win.waitForTimeout(200);
    return list;
  };
  const switchTo = async (name) => {
    await openSwitcher();
    await win.locator(`[data-testid="timeline-item-${name}"]`).click();
    await win.waitForTimeout(1200);
  };
  const undoOn = async () => !/cursor-not-allowed/.test((await win.locator("[title=Undo]").first().getAttribute("class")) ?? "");
  const blurred = () => win.evaluate(() => document.activeElement?.blur?.());

  // ---- a project from before several timelines ----------------------------------------------
  let doc = await saved();
  const video = doc.timeline.clips.find((c) => c.type === "video");
  const videoSecs = (+video.endTick - +video.startTick) / 1e6;
  check("the project has the one timeline, no others in its file", !doc.moreTimelines && doc.timeline.clips.length >= 1);
  check("the player's title names it: Player-Timeline 01", (await title()).replace(/\s+/g, "") === "Player-Timeline01".replace(/\s+/g, "") || /Timeline 01/.test(await title()), await title());
  const first = (await names())[0];
  check("the title's menu lists just it, open", (await names()).length === 1 && first.name === "Timeline 01" && first.active, JSON.stringify(await names()));
  check("Delete timeline is off with only one", await win.evaluate(() => 0).then(async () => {
    await openSwitcher();
    const off = (await win.locator("[data-testid=timeline-delete]").getAttribute("data-disabled")) !== null;
    await win.keyboard.press("Escape");
    return off;
  }));

  await seek(win, ctx.map, 2);
  await win.waitForTimeout(800);
  const f0 = await engineFrame(win);
  check("Timeline 01 shows the video at 2 s", f0.light > 0.04, `${f0.light.toFixed(3)}`);
  await blurred();
  await win.keyboard.press("m");
  await win.waitForTimeout(600);
  check("an edit in Timeline 01 (a marker) is an undo step", await undoOn());
  doc = await saved();
  check("the marker is saved in Timeline 01", (doc.timeline.markers ?? []).length === 1);

  // ---- File > New timeline ---------------------------------------------------------------------
  await shot("tl1-menu");
  check("File > New timeline is in the menu bar", await fileMenu("new-timeline"));
  await win.waitForTimeout(1500);
  check("it opens Timeline 02, empty", /Timeline 02/.test(await title()), await title());
  const f1 = await engineFrame(win);
  check("the player shows nothing (black) for the empty timeline", f1.light < 0.01, `${f1.light.toFixed(3)}`);
  check("undo is Timeline 01's: nothing to undo in the new timeline", !(await undoOn()));
  doc = await saved();
  check("the file has two timelines, Timeline 01 first with its clips", all(doc).length === 2 && all(doc)[0].name === "Timeline 01" && all(doc)[0].clips.length >= 1 && all(doc)[1].name === "Timeline 02" && all(doc)[1].clips.length === 0, all(doc).map((t) => `${t.name}:${t.clips.length}`).join(" "));
  check("Timeline 02 is the one open in the file", doc.editorState.activeTimeline === all(doc)[1].id && all(doc)[0].id !== all(doc)[1].id);
  check("the media are shared: the project keeps its assets", Object.keys(doc.assets).length >= 1);

  // ---- switch back and forth ---------------------------------------------------------------------
  await switchTo("Timeline 01");
  await shot("tl2-switcher");
  check("switching back shows Timeline 01", /Timeline 01/.test(await title()));
  const f2 = await engineFrame(win);
  check("the engine's frame at the playhead is what it was", f2.sum === f0.sum, `${f2.sum} vs ${f0.sum}`);
  check("undo is Timeline 01's again", await undoOn());
  await blurred();
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(600);
  doc = await saved();
  check("undo takes back the marker in Timeline 01", (doc.timeline.markers ?? []).length === 0);
  await win.keyboard.press("Meta+Shift+z");
  await win.waitForTimeout(600);
  await switchTo("Timeline 02");
  check("and forth: Timeline 02 is empty again", f1.light < 0.01 && (await engineFrame(win)).light < 0.01);

  // ---- rename, duplicate, delete -----------------------------------------------------------------
  await switchTo("Timeline 01");
  await openSwitcher();
  await win.locator("[data-testid=timeline-rename]").click();
  const input = win.locator("[data-testid=timeline-rename-input]");
  await input.waitFor({ state: "visible" });
  await input.fill("Intro");
  await input.press("Enter");
  await win.waitForTimeout(600);
  check("Rename timeline: the title says Intro", /Intro/.test(await title()), await title());
  await input.waitFor({ state: "hidden" }).catch(() => {});
  doc = await saved();
  check("the file has the new name", all(doc)[0].name === "Intro", all(doc).map((t) => t.name).join());

  await pickMenu("timeline-duplicate");
  doc = await saved();
  const [orig, copy] = [all(doc)[0], all(doc)[1]];
  check("Duplicate timeline: a copy named Intro copy, opened", /Intro copy/.test(await title()) && all(doc).length === 3 && copy.name === "Intro copy", `${await title()} ${all(doc).map((t) => t.name).join()}`);
  const ids = (t) => [...t.clips.map((c) => c.clipId), ...t.tracks.map((k) => k.timelineId), ...(t.markers ?? []).map((m) => m.id)];
  check("the copy has the same clips and shares no id with the original", copy.clips.length === orig.clips.length && ids(copy).every((i) => !ids(orig).includes(i)), `${copy.clips.length} clips`);
  const fc = await engineFrame(win);
  check("it shows the same picture", fc.sum === f0.sum, `${fc.sum} vs ${f0.sum}`);
  check("the copy is the open one in the file", doc.editorState.activeTimeline === copy.id);

  await pickMenu("timeline-delete");
  doc = await saved();
  check("Delete timeline removes the open one and opens another", all(doc).length === 2 && !all(doc).some((t) => t.name === "Intro copy") && !/copy/.test(await title()), `${await title()} ${all(doc).map((t) => t.name).join()}`);
  check("Intro is still there with its clips", all(doc).find((t) => t.name === "Intro")?.clips.length >= 1);

  // ---- the media card: New timeline with selected item --------------------------------------------
  const png = path.join(outDir, "blue-photo.png");
  execFileSync(require("ffmpeg-static"), ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", png], { stdio: "ignore" });
  await ctx.app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, png);
  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(800);
  await win.locator("[data-testid=media-import]").first().click();
  const card = win.locator("[data-testid=media-card][data-name^=blue-photo]");
  for (let i = 0; i < 20 && !(await card.count()); i++) await win.waitForTimeout(500);
  await card.click({ position: { x: 60, y: 40 } });
  await card.click({ button: "right", position: { x: 60, y: 40 } });
  await win.waitForTimeout(300);
  await shot("tl3-card-menu");
  check("the card's menu has New timeline with selected item", (await win.locator("[data-testid=media-new-timeline]").count()) === 1);
  await win.locator("[data-testid=media-new-timeline]").click();
  await win.waitForTimeout(2500);
  check("a new timeline opens, named Timeline 01 (the smallest free number, Intro having taken the first's place)", /Timeline 01/.test(await title()), await title());
  doc = await saved();
  const photoTl = all(doc).find((t) => t.id === doc.editorState.activeTimeline);
  const photoClips = photoTl?.clips ?? [];
  check("it holds the photo, one clip from 0", photoClips.length === 1 && photoClips[0].type === "image" && +photoClips[0].startTick === 0, photoClips.map((c) => `${c.type}@${c.startTick}`).join());
  const photoSecs = photoClips[0] ? (+photoClips[0].endTick - +photoClips[0].startTick) / 1e6 : 0;
  await seek(win, ctx.map, 1);
  await win.waitForTimeout(800);
  const fb = await engineFrame(win, "b > 150 && r < 80 && g < 80");
  check("the player shows the blue photo", fb.count > fb.w * fb.h * 0.2, `${fb.count} blue pixels`);
  check("the media card for the photo and the video are still in the library", (await win.locator("[data-testid=media-card]").count()) >= 2);

  // ---- the Export dialog's timeline chooser -----------------------------------------------------
  const dialog = win.locator("[data-testid=export-dialog]");
  const T = (id) => dialog.locator(`[data-testid=${id}]`);
  const open = async () => {
    await win.locator("[data-testid=export]").click();
    await dialog.waitFor({ state: "visible" });
    await win.waitForTimeout(600);
  };
  const setCheck = async (id, on) => {
    const box = T(`export-${id}-check`);
    await box.scrollIntoViewIfNeeded();
    if (((await box.getAttribute("data-checked")) === "true") !== on) await box.click();
  };
  const finish = async () => {
    for (let i = 0; i < 600; i++) {
      const phase = await T("export-run").getAttribute("data-phase").catch(() => null);
      if (phase && phase !== "running") return phase;
      await win.waitForTimeout(500);
    }
    throw new Error("export never ended");
  };
  const exportAs = async (name, timeline) => {
    await open();
    const sel = T("export-timeline");
    if (timeline) {
      await sel.click();
      await win.locator("[data-testid=export-timeline-option]").filter({ hasText: new RegExp(`^${timeline}$`) }).first().click();
      await win.waitForTimeout(500);
    }
    await setCheck("video", true);
    await setCheck("audio", false);
    await setCheck("gif", false);
    await setCheck("captions", false);
    await T("export-resolution").click();
    await win.locator("[data-testid=export-resolution-option]").filter({ hasText: "480P" }).first().click();
    await T("export-name").fill(name);
    await T("export-path").fill(outDir);
    const picked = await sel.innerText();
    await T("export-submit").click();
    const phase = await finish();
    await T("export-run-done").click();
    await dialog.waitFor({ state: "hidden" });
    return { phase, picked };
  };
  fs.rmSync(path.join(outDir, "tl-photo.mp4"), { force: true });
  fs.rmSync(path.join(outDir, "tl-video.mp4"), { force: true });
  await open();
  check("the Export timeline row is a choice of the project's timelines, the open one first picked", (await T("export-timeline").innerText()).trim() === "Timeline 01" && (await T("export-timeline").getAttribute("data-value")) === photoTl.id);
  await shot("tl4-export");
  await T("export-timeline").click();
  const opts = (await win.locator("[data-testid=export-timeline-option]").allInnerTexts()).map((t) => t.trim());
  check(`it lists them: ${opts.join(", ")}`, opts.join(",") === "Intro,Timeline 02,Timeline 01");
  await win.keyboard.press("Escape");
  await win.locator("[data-testid=export-cancel]").click();
  await dialog.waitFor({ state: "hidden" });

  const a = await exportAs("tl-photo", null);
  check("exporting the open timeline (the photo) finishes", a.phase === "done", a.phase);
  const pa = probe(path.join(outDir, "tl-photo.mp4"));
  const da = +pa.format.duration;
  check(`its file is the photo's length (${photoSecs.toFixed(1)} s): ${da.toFixed(2)} s`, Math.abs(da - photoSecs) < 0.3, `${da}`);

  const b = await exportAs("tl-video", "Intro");
  check("choosing Intro in the dialog exports it though Timeline 02 is open", b.phase === "done" && b.picked === "Intro", `${b.phase} ${b.picked}`);
  const pb = probe(path.join(outDir, "tl-video.mp4"));
  const db = +pb.format.duration;
  check(`its file is the video's length (${videoSecs.toFixed(1)} s): ${db.toFixed(2)} s`, Math.abs(db - videoSecs) < 0.5, `${db}`);
  check("the open timeline didn't change", /Timeline 01/.test(await title()));

  // ---- it all survives a restart -------------------------------------------------------------------
  doc = await saved();
  const before = all(doc).map((t) => `${t.name}:${t.clips.length}`).join(" ");
  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await win.waitForTimeout(3000);
  const again = await names();
  check("after a restart the timelines are all there, in order, Timeline 01 (the photo) open", again.map((t) => t.name).join() === "Intro,Timeline 02,Timeline 01" && again[2].active, JSON.stringify(again));
  check("the player shows the photo timeline's photo", (await engineFrame(win, "b > 150 && r < 80 && g < 80")).count > 1000);
  await switchTo("Intro");
  await win.waitForTimeout(1500);
  check("Intro still has its video", (await engineFrame(win)).light > 0.01);
  doc = await saved();
  check("the file is the same after the restart's own save", all(doc).map((t) => `${t.name}:${t.clips.length}`).join(" ") === before, `${before} -> ${all(doc).map((t) => `${t.name}:${t.clips.length}`).join(" ")}`);
  await shot("tl5-reopened");
  return report();
};
