// Project settings (after `import timeline`; `CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1` on the 4K
// clip): the inspector's Details and its Modify, as CapCut's (shots named after
// 17-inspector-project: ps01 ↔ 010, ps02 ↔ 001, ps03 ↔ 002, ps04 ↔ 004, ps05 ↔ 006, ps06 ↔ 007,
// ps07 ↔ 008). Every row is changed and checked in the saved project and where the engine shows it:
// the name, the frame rate (and the clips' timing), the aspect ratio (the engine's frame), the
// Custom resolution (the canvas the engine reports, and a still exported at its size), Save to
// (the project files move, then back), the filter clip length; the colour space and proxy rows are
// disabled with their notes; Cancel changes nothing; each change to the canvas and frame rate is
// undone and redone. PS_KEEP=1 leaves the project on its last settings (for projectsettingscheck,
// after `reopen`).
import path from "node:path";
import { rulerMap } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { stubFolderPicker } from "./_settings.mjs";

export default async (ctx) => {
  const { win, app, shot, udDir, outDir } = ctx;
  const { check, report } = checks();
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const doc = () => savedProject(win, udDir);
  const dialog = win.locator("[data-testid=project-settings]");

  // The project inspector's Details (a click on the ruler drops the selection), then Modify.
  const details = async () => {
    await win.mouse.click(map.x(0.5), map.y);
    await win.waitForTimeout(400);
    await win.locator("[data-testid=project-tab-details]").click();
    await win.waitForTimeout(300);
  };
  const detailsText = async () => (await win.locator("[data-testid=inspector-project]").innerText()).replace(/\s+/g, " ");
  const open = async () => {
    await details();
    await win.locator("[data-testid=project-modify]").click();
    await dialog.waitFor({ timeout: 5000 });
    await win.waitForTimeout(500);
  };
  const choose = async (id, value) => {
    await win.locator(`[data-testid=${id}]`).click();
    await win.waitForTimeout(250);
    await win.locator(`[data-testid=${id}-option][data-value="${value}"]`).click();
    await win.waitForTimeout(250);
  };
  const options = async (id) => {
    await win.locator(`[data-testid=${id}]`).click();
    await win.waitForTimeout(300);
    const list = await win.evaluate((id) => [...document.querySelectorAll(`[data-testid=${id}-option]`)].map((e) => ({ label: e.innerText.trim(), disabled: e.hasAttribute("data-disabled") || e.getAttribute("aria-disabled") === "true" })), id);
    return list;
  };
  const save = async () => {
    await win.locator("[data-testid=ps-save]").click();
    await dialog.waitFor({ state: "hidden", timeout: 10000 });
    await win.waitForTimeout(800);
  };
  const canvasText = async () => /Canvas: (\d+) × (\d+)/.exec(await detailsText())?.slice(1).map(Number);
  const frameSize = () => win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    return { w: c.width, h: c.height };
  });
  const clipSeconds = async () => {
    const d = await doc();
    const c = d.timeline.clips.filter((x) => x.type === "video").sort((a, b) => +a.startTick - +b.startTick)[0];
    return (Number(c.endTick) - Number(c.startTick)) / 1e6;
  };

  const before = await doc();
  const fps0 = before.settings.fps;
  const aspect0 = before.settings.aspectRatio;
  const seconds0 = await clipSeconds();

  // ---- The inspector's Details, and the dialog's two tabs ----
  await details();
  await shot("ps01-details"); // 17-inspector-project/010
  const rows = await detailsText();
  check("Details lists Name, Path, Imported media, Arrange layers, Proxy, Aspect ratio, Resolution, Frame rate", ["Name:", "Path:", "Imported media:", "Arrange layers:", "Proxy:", "Aspect ratio:", "Resolution:", "Frame rate:"].every((l) => rows.includes(l)), rows.slice(0, 160));
  await win.locator("[data-testid=project-modify]").click();
  await dialog.waitFor({ timeout: 5000 });
  await win.waitForTimeout(600);
  await shot("ps02-dialog-details"); // 17-inspector-project/001
  const text = (await dialog.innerText()).replace(/\s+/g, " ");
  check("Project settings has CapCut's Details rows", ["Details", "Name", "Save to", "Imported media", "Copy media to project", "Stay in original location", "Color space", "Rec. 709 SDR", "Arrange layers", "Timeline settings", "Apply to", "Aspect ratio", "Resolution", "Adapted", "Frame rate"].every((w) => text.includes(w)), text.slice(0, 200));
  const box = await dialog.boundingBox();
  check("the dialog is 512 wide with Cancel and Save", Math.abs(box.width - 512) < 2 && (await win.locator("[data-testid=ps-cancel]").count()) === 1 && (await win.locator("[data-testid=ps-save]").count()) === 1, `${box.width}×${box.height}`);
  check("Name is the project's name", (await win.locator("[data-testid=ps-name]").inputValue()) === (await win.locator("[data-testid=project-name]").inputValue()));
  check("Save to shows the projects folder", (await win.locator("[data-testid=ps-save-to]").getAttribute("title")) === path.join(udDir, "projects-json"), await win.locator("[data-testid=ps-save-to]").getAttribute("title"));

  // Colour space: SDR Rec.709 is the one OpenRip renders in; the rest are disabled.
  const spaces = await options("ps-color-space");
  await shot("ps03-color-space-dropdown"); // 002
  check("Color space lists CapCut's four, only Rec. 709 SDR usable", JSON.stringify(spaces) === JSON.stringify([{ label: "Rec. 709 SDR", disabled: false }, { label: "Rec. 2020 SDR", disabled: true }, { label: "Rec. 2100 HLG", disabled: true }, { label: "Rec. 2100 PQ", disabled: true }]), JSON.stringify(spaces));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(250);
  // Aspect ratio, Resolution, Frame rate: CapCut's lists.
  const aspects = await options("ps-aspect");
  await shot("ps04-aspect-ratio-dropdown"); // 004
  check("Aspect ratio lists CapCut's ten", aspects.map((a) => a.label).join(",") === "Original,16:9,4:3,2.35:1,2:1,1.85:1,9:16,3:4,5.8-inch,1:1", aspects.map((a) => a.label).join(","));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(250);
  const resolutions = await options("ps-resolution");
  await shot("ps05-resolution-dropdown"); // 006
  check("Resolution is Adapted or Custom", resolutions.map((a) => a.label).join(",") === "Adapted,Custom", resolutions.map((a) => a.label).join(","));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(250);
  const rates = await options("ps-fps");
  await shot("ps06-frame-rate-dropdown"); // 007
  check("Frame rate lists 24, 25, 29.97, 30, 50, 59.94, 60", rates.map((a) => a.label).join(",") === "24.00 fps,25.00 fps,29.97 fps,30.00 fps,50.00 fps,59.94 fps,60.00 fps", rates.map((a) => a.label).join(","));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(250);
  // Performance: proxies, disabled with a note.
  await win.locator("[data-testid=ps-tab-performance]").click();
  await win.waitForTimeout(300);
  await shot("ps07-performance"); // 008
  const perf = (await dialog.innerText()).replace(/\s+/g, " ");
  check("Performance has Proxy and its Resolution, disabled with a note", /Proxy/.test(perf) && /Resolution/.test(perf) && (await win.locator("[data-testid=ps-proxy]").isDisabled()) && /proxies aren't used/.test(perf), perf.slice(0, 160));
  // Cancel changes nothing.
  await win.locator("[data-testid=ps-tab-details]").click();
  await win.locator("[data-testid=ps-name]").fill("Not saved");
  await choose("ps-fps", "60");
  await win.locator("[data-testid=ps-cancel]").click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  await win.waitForTimeout(800);
  const afterCancel = await doc();
  check("Cancel leaves the name and frame rate", afterCancel.meta.name === before.meta.name && afterCancel.settings.fps === fps0, `${afterCancel.meta.name}, ${afterCancel.settings.fps}`);

  // ---- Name ----
  await open();
  await win.locator("[data-testid=ps-name]").fill("PS Renamed");
  await save();
  await win.waitForTimeout(1500);
  check("Name renames the project (the saved file and the top bar)", (await doc()).meta.name === "PS Renamed" && (await win.locator("[data-testid=project-name]").inputValue()) === "PS Renamed", (await doc()).meta.name);
  check("the Details row follows", (await detailsText()).includes("Name: PS Renamed"));

  // ---- Frame rate: the project's rate, the clips' timing kept; one undo step ----
  const rate = await undoCase(ctx, check, "frame rate 30", async () => {
    await open();
    await choose("ps-fps", "30");
    await save();
  }, { frame: false });
  const afterRate = rate.after.doc ? JSON.parse(rate.after.doc) : {};
  check("Frame rate 30 is saved and the clip keeps its length", afterRate.fps === 30 && Math.abs((await clipSeconds()) - seconds0) < 0.1, `fps ${afterRate.fps}, ${(await clipSeconds()).toFixed(2)} s vs ${seconds0.toFixed(2)} s`);
  check("the Details row says 30.00fps", /Frame rate: 30\.00fps/.test(await detailsText()), (/Frame rate: \S+/.exec(await detailsText()) ?? [""])[0]);

  // ---- Aspect ratio: 1:1, the engine's frame goes square ----
  const sq = await undoCase(ctx, check, "aspect 1:1", async () => {
    await open();
    await choose("ps-aspect", "1:1");
    await save();
  });
  const squareDoc = JSON.parse(sq.after.doc);
  check("Aspect ratio 1:1 is saved", squareDoc.aspect?.id === "1:1" && !squareDoc.canvas, JSON.stringify(squareDoc.aspect));
  // (undoCase redid it.)
  const fs1 = await frameSize();
  check("the engine's frame is square", Math.abs(fs1.w / fs1.h - 1) < 0.01, `${fs1.w}×${fs1.h}`);
  const c1 = await canvasText();
  check("the engine's canvas is 1920×1920 and Details says Adapted", c1?.[0] === 1920 && c1?.[1] === 1920 && /Resolution: Adapted/.test(await detailsText()), `${c1}`);

  // ---- Resolution Custom: 720 × 1280 ----
  const cust = await undoCase(ctx, check, "resolution 720×1280", async () => {
    await open();
    await choose("ps-resolution", "custom");
    await win.locator("[data-testid=ps-width]").fill("720");
    await win.locator("[data-testid=ps-width]").press("Enter");
    await win.locator("[data-testid=ps-height]").fill("1280");
    await win.locator("[data-testid=ps-height]").press("Enter");
    await win.waitForTimeout(300);
    await shot("ps08-custom-resolution");
    await save();
  });
  const customDoc = JSON.parse(cust.after.doc);
  check("Custom 720×1280 is saved with its ratio (9:16)", customDoc.canvas?.width === 720 && customDoc.canvas?.height === 1280 && customDoc.aspect?.id === "9:16", JSON.stringify([customDoc.canvas, customDoc.aspect]));
  const c2 = await canvasText();
  check("the engine's canvas is 720×1280 and Details says it", c2?.[0] === 720 && c2?.[1] === 1280 && /Resolution: 720 × 1280/.test(await detailsText()), `${c2}`);
  const fs2 = await frameSize();
  check("the engine's frame is 9:16", Math.abs(fs2.w / fs2.h - 9 / 16) < 0.01, `${fs2.w}×${fs2.h}`);
  // A still exported at the project's size.
  {
    const file = path.join(outDir, "ps-still.png");
    ctx.fs.rmSync(file, { force: true });
    await app.evaluate(({ ipcMain }, f) => {
      ipcMain.removeHandler("dialog:pick-save-path");
      ipcMain.handle("dialog:pick-save-path", async () => f);
    }, file);
    await win.locator("[data-testid=player-menu]").click();
    await win.waitForTimeout(250);
    await win.locator("[data-testid=export-still]").click();
    for (let i = 0; i < 120 && !ctx.fs.existsSync(file); i++) await win.waitForTimeout(250);
    await win.waitForTimeout(800);
    const buf = ctx.fs.existsSync(file) ? ctx.fs.readFileSync(file) : Buffer.alloc(0);
    const [pw, ph] = buf.length > 24 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : [0, 0];
    check("an exported still is 720×1280", pw === 720 && ph === 1280, `${pw}×${ph}`);
  }
  // Adapted again: the canvas goes back to the ratio's own size.
  await open();
  await choose("ps-resolution", "adapted");
  await save();
  const c3 = await canvasText();
  const savedAdapted = await doc();
  check("Adapted drops the custom size (9:16 is 1080×1920 by the long side 1920)", !savedAdapted.settings.engineCanvas && c3?.[1] === 1920 && Math.abs(c3[0] / c3[1] - 9 / 16) < 0.01, `${c3}`);

  // ---- Filter clip length ----
  await open();
  await choose("ps-filter-length", "10");
  await save();
  check("Filter clip length 10 s is saved", (await doc()).settings.defaultClipLength === 10, String((await doc()).settings.defaultClipLength));

  // ---- Save to: the project files move, then back ----
  const files = (dir) => (ctx.fs.existsSync(dir) ? ctx.fs.readdirSync(dir).filter((f) => /^project-\d+\.json$/.test(f)) : []);
  const home = path.join(udDir, "projects-json");
  const moved = path.join(outDir, "moved-ps");
  ctx.fs.rmSync(moved, { recursive: true, force: true });
  const n = files(home).length;
  await stubFolderPicker(app, moved);
  await open();
  await win.locator("[data-testid=ps-save-to-pick]").click();
  await win.waitForTimeout(300);
  const shown = await win.locator("[data-testid=ps-save-to]").getAttribute("title");
  await save();
  await win.waitForTimeout(1500);
  check("Save to moves the project folder", shown === moved && n >= 1 && files(moved).length === n && files(home).length === 0, `${n} files; there ${files(moved).length}, left ${files(home).length}`);
  await stubFolderPicker(app, home);
  await open();
  await win.locator("[data-testid=ps-save-to-pick]").click();
  await save();
  await win.waitForTimeout(1500);
  check("and back", files(home).length === n && files(moved).length === 0, `${files(home).length} back, ${files(moved).length} left`);

  // ---- Back to the project's own canvas, unless kept for the reopen check ----
  if (!process.env.PS_KEEP) {
    await open();
    await choose("ps-aspect", aspect0.id === "custom" ? "16:9" : aspect0.id);
    await choose("ps-fps", String(fps0));
    await choose("ps-filter-length", "5");
    await save();
  }
  return report();
};
