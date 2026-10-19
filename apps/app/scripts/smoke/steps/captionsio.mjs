// The Captions tab (after import timeline, nothing else on the timeline): fixtures/captions.srt
// imported through Add captions (the file dialog stubbed) in the Yellow style onto a track of
// its own, with the file's timing, drawn by the engine, undone and redone as one step; its
// file card; a template restyling the selected caption's whole track; and Export captions
// (the save dialog stubbed) writing the timeline's texts as the same SRT.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { engineFrame, rulerMap, seek, settled, sectionButton } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";

const fixture = fileURLToPath(new URL("../fixtures/captions.srt", import.meta.url));

export default async (ctx) => {
  const { app, win, udDir, shot, outDir, fs } = ctx;
  const { check, report } = checks();
  const out = path.join(outDir, "captions-export.srt");
  await app.evaluate(({ ipcMain }, [srt, out]) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [srt]);
    ipcMain.removeHandler("dialog:pick-save-path");
    ipcMain.handle("dialog:pick-save-path", async () => out);
  }, [fixture, out]);
  const doc = () => savedProject(win, udDir);
  const captions = async () => (await doc()).timeline.clips.filter((c) => c.type === "text").sort((a, b) => +a.startTick - +b.startTick);

  ctx.map ??= await rulerMap(win);
  await seek(win, ctx.map, 0.5);
  await win.locator("[data-testid=assets-tab-captions]").click();
  // The column opens on Auto captions; the file import is Add captions.
  await (await sectionButton(win, "add")).click();
  await win.waitForTimeout(400);
  await shot("cio1-add-captions");
  await win.locator("[data-testid=caption-style]").selectOption("yellow");
  const f0 = (await engineFrame(win)).sum;
  await undoCase(ctx, check, "import captions", () => settled(win, () => win.locator("[data-testid=captions-import]").click()));
  const got = await captions();
  const tracks = new Set(got.map((c) => c.timelineId));
  const near = (a, b) => Math.abs(a - b) < 0.6 / 24;
  const t = got.map((c) => [+c.startTick / 1e6, +c.endTick / 1e6]);
  check(
    `four captions on a track of their own, the file's timing ${JSON.stringify(t.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]))}`,
    got.length === 4 && tracks.size === 1 && near(t[0][0], 0.25) && near(t[0][1], 1.3) && near(t[1][0], 1.3) && near(t[2][0], 3) && near(t[3][1], 5.75) && got[1].text === "A second one\nover two lines",
  );
  check("in the chosen style (Yellow)", got.every((c) => c.color === "#ffd84d" && c.strokeEnabled), got.map((c) => c.color).join(","));
  check("the engine draws the caption at 0.5 s", (await engineFrame(win, "r > 200 && g > 170 && b < 120")).count > 50 && (await engineFrame(win)).sum !== f0);
  check("the file's card", (await win.locator("[data-testid=captions-file]").count()) === 1 && /Added 4 captions/.test(await win.locator("[data-testid=captions-message]").innerText()));
  await shot("cio2-imported");

  // A template on the selected caption's track: every caption gets it.
  await select(ctx, await doc(), got[0].clipId, 0.5);
  await win.locator("[data-testid=assets-tab-captions]").click();
  await (await sectionButton(win, "templates")).click();
  await win.waitForTimeout(300);
  await shot("cio3-templates");
  const f1 = (await engineFrame(win)).sum;
  await settled(win, () => win.locator("[data-testid=caption-style-caption_box]").click());
  const boxed = await captions();
  check("a template restyles the whole caption track", boxed.length === 4 && boxed.every((c) => c.backgroundEnabled && c.backgroundOpacity === 70) && (await engineFrame(win)).sum !== f1, boxed.map((c) => c.backgroundEnabled).join(","));

  // Export: the timeline's texts as SRT, on the frames the captions took.
  await (await sectionButton(win, "add")).click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=captions-export]").click();
  // Once written whole (the file exists as soon as the write starts).
  const written = () => (fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "");
  for (let i = 0; i < 50 && !/And the last\s*$/.test(written()); i++) await win.waitForTimeout(200);
  const srt = written();
  const blocks = srt.trim().split(/\n\n/);
  const secs = (s) => s.split(/[:,]/).reduce((sum, v, i) => sum + +v * [3600, 60, 1, 0.001][i], 0);
  const times = blocks.map((b) => b.split("\n")[1]?.split(" --> ").map(secs) ?? []);
  check(
    `Export captions writes them as SRT (${blocks.length} cues, the second "${blocks[1]?.split("\n").slice(2).join(" / ")}")`,
    blocks.length === 4 && times.every(([s, e], i) => Math.abs(s - t[i][0]) < 0.0011 && Math.abs(e - t[i][1]) < 0.0011) && blocks[1].endsWith("A second one\nover two lines"),
    JSON.stringify(times),
  );
  return report();
};
