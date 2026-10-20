// The Settings rows that used to be disabled and now act (after `import`; OPENRIP_ENGINE_MUTE=1,
// built app; FFmpeg from ffmpeg-static makes a recording to save):
// - Draft > Screen recording: a folder picked (the native picker stubbed) and saved; Record's
//   save puts "Recording 1.mp4" there; Default goes back to the project's media folder;
// - Draft > Preset save path: a folder picked; the presets file is carried over to it and written
//   there from then on (not in the old folder);
// - Performance > Rendering cache: its folder and size shown, Clear emptying it (the Draft cache
//   size follows); Auto clear's limit trimming the oldest files first;
// - Play audio while scrubbing and Arrange layers by default are live now (the
//   `settings` step lists every row's state).
// Shots: `sr1-draft` ↔ `02-settings/001-draft`, `sr2-performance` ↔ `011-performance`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { checks } from "./_anim.mjs";
import { openSettingsFromEditor, prefsOf, settingsTab } from "./_settings.mjs";

export default async (ctx) => {
  const { win, app, shot, udDir, outDir, appDir, fs } = ctx;
  const { check, report } = checks();
  const require = createRequire(appDir + "/package.json");
  const recDir = path.join(outDir, "my-recordings");
  const presetDir = path.join(outDir, "my-presets");
  fs.mkdirSync(recDir, { recursive: true });
  fs.mkdirSync(presetDir, { recursive: true });
  const pick = (dir) =>
    app.evaluate(({ ipcMain }, d) => {
      ipcMain.removeHandler("settings:pick-folder");
      ipcMain.handle("settings:pick-folder", async () => d);
    }, dir);
  const call = (name, ...args) => win.evaluate(({ n, a }) => window[btoa(n)](...a), { n: name, a: args });
  const save = async () => {
    await win.locator("[data-testid=settings-save]").click();
    await win.waitForTimeout(800);
  };

  // ---- Draft ----
  await openSettingsFromEditor(win);
  await settingsTab(win, "draft");
  check("Screen recording and Preset save path are enabled", !(await win.locator("[data-testid=settings-row-screenRecording]").getAttribute("data-disabled")) && !(await win.locator("[data-testid=settings-row-presetPath]").getAttribute("data-disabled")));
  check("Screen recording shows the project's media folder by default", /recordings/.test((await win.locator("[data-testid=settings-recordings-dir]").getAttribute("title")) ?? ""));
  await pick(recDir);
  await win.locator("[data-testid=settings-recordings-dir-pick]").click();
  await win.waitForTimeout(300);
  check("the picked folder shows", (await win.locator("[data-testid=settings-recordings-dir]").getAttribute("title")) === recDir);
  // The presets file first, so there is something to carry over.
  await call("clipPresetsWrite", '{"v":1,"marker":"carried"}');
  await pick(presetDir);
  await win.locator("[data-testid=settings-presets-dir-pick]").click();
  await shot("sr1-draft");
  await save();
  const prefs = await prefsOf(win);
  check("both folders are saved in the preferences", prefs.recordingsDir === recDir && prefs.presetsDir === presetDir, JSON.stringify([prefs.recordingsDir, prefs.presetsDir]));

  // A recording lands in the chosen folder.
  const webm = path.join(outDir, "rec.webm");
  execFileSync(require("ffmpeg-static"), ["-y", "-f", "lavfi", "-i", "testsrc=d=1:s=160x90:r=10", "-c:v", "libvpx", webm], { stdio: "ignore" });
  const bytes = [...fs.readFileSync(webm)];
  const saved = await win.evaluate(async ({ b }) => window[btoa("recordingSave")](new Uint8Array(b).buffer, { hasAudio: false, fps: 10 }), { b: bytes });
  check("Record's save puts the file in the chosen folder", saved.path === path.join(recDir, "Recording 1.mp4") && fs.existsSync(saved.path), saved.path);

  // The presets file moved with the setting.
  await win.waitForTimeout(500);
  const moved = path.join(presetDir, "presets.json");
  check("the presets file was carried to the new folder", fs.existsSync(moved) && fs.readFileSync(moved, "utf8").includes("carried"));
  await call("clipPresetsWrite", '{"v":1,"marker":"new"}');
  check("later writes go to the new folder only", fs.readFileSync(moved, "utf8").includes('"new"') && fs.readFileSync(path.join(udDir, "clip-presets", "presets.json"), "utf8").includes("carried"));
  check("reading gives the new folder's file", (await call("clipPresetsRead")).includes('"new"'));

  // Default goes back.
  await openSettingsFromEditor(win);
  await settingsTab(win, "draft");
  await win.locator("[data-testid=settings-recordings-default]").click();
  await win.locator("[data-testid=settings-presets-default]").click();
  await save();
  const back = await prefsOf(win);
  check("Default clears both", back.recordingsDir === "" && back.presetsDir === "", JSON.stringify([back.recordingsDir, back.presetsDir]));

  // ---- Performance: the rendering cache ----
  const cache = path.join(udDir, "engine-thumbnails");
  fs.rmSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { recursive: true });
  const put = (name, mb, ageMin) => {
    const f = path.join(cache, name);
    fs.writeFileSync(f, Buffer.alloc(mb * 1024 * 1024, 1));
    const t = new Date(Date.now() - ageMin * 60000);
    fs.utimesSync(f, t, t);
  };
  put("old.bin", 2, 30);
  put("mid.bin", 2, 20);
  put("new.bin", 2, 10);
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  await win.waitForTimeout(500);
  check("the rendering cache rows are enabled and show its folder", (await win.locator("[data-testid=settings-render-cache-path]").getAttribute("title")) === cache);
  const bytes0 = +(await win.locator("[data-testid=settings-render-cache-size]").getAttribute("data-bytes"));
  check("its size counts the files", bytes0 >= 6 * 1024 * 1024, String(bytes0));
  await shot("sr2-performance");
  await win.locator("[data-testid=settings-cancel]").click();
  // Auto clear: a limit of about 3 MB drops the oldest files first.
  await call("setPreferences", { renderCacheMaxGb: 0.003 });
  await win.waitForTimeout(1500);
  check("a limit trims the oldest files first", !fs.existsSync(path.join(cache, "old.bin")) && !fs.existsSync(path.join(cache, "mid.bin")) && fs.existsSync(path.join(cache, "new.bin")));
  await call("setPreferences", { renderCacheMaxGb: 10 });
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  await win.waitForTimeout(500);
  await win.locator("[data-testid=settings-render-cache-size]").locator("xpath=following-sibling::button").click();
  await win.waitForTimeout(1200);
  check("Clear empties the rendering cache", +(await win.locator("[data-testid=settings-render-cache-size]").getAttribute("data-bytes")) < 1024 * 1024 && !fs.existsSync(path.join(cache, "new.bin")));
  await settingsTab(win, "edit");
  const rows = await win.evaluate(() => ["scrubAudio", "arrangeLayers"].map((id) => document.querySelector(`[data-testid=settings-row-${id}]`)?.getAttribute("data-disabled")));
  check("Play audio while scrubbing and Arrange layers by default are live", rows.every((d) => d !== "true"), rows.join());
  await win.locator("[data-testid=settings-cancel]").click();
  return report();
};
