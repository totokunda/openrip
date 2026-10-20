// Rendering cache location and Auto render (after `import timeline`; `~/Downloads/IMG_9079.MOV`
// with CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1; docs/plan/capcut-ui-spec.md §6.3 Performance ›
// Rendering cache location, Auto render):
// - Auto render is off by default (Settings › Performance, a toggle with its note); nothing is
//   rendered while the project sits there;
// - turned on and saved, the timeline is rendered into the engine's cache by itself once it has
//   been left alone for a few seconds (no menu used): the engine reports rendered ranges, chunk
//   files are in `<cache>/prerender`; the Render menu's own "Already rendered" is not needed;
// - an edit (a split, undone) interrupts a render and the ranges stay valid; the render picks up
//   again when the editing pauses (chunks already rendered are reused);
// - the location: the folder picker (stubbed) and Save move the folder's files to the new place
//   (the rendered chunks and their index carried over, the old folder emptied), the engine reads
//   the carried chunks from there (the rendered ranges are unchanged), the size row counts the
//   new folder, new renders land in it; Default goes back and carries them again;
// - turned off, an edit and the idle time render nothing new.
// Shots: `ar1-settings` ↔ `02-settings/011`, `ar2-picker` ↔ `025-performance-rendering-path-picker`.
import path from "node:path";
import { checks } from "./_anim.mjs";
import { openSettingsFromEditor, settingsTab, prefsOf, stubFolderPicker } from "./_settings.mjs";

export default async (ctx) => {
  const { win, app, shot, udDir, outDir, fs } = ctx;
  const { check, report } = checks();
  const call = (name, ...args) => win.evaluate(({ n, a }) => window[btoa(n)](...a), { n: name, a: args });
  const defaultDir = path.join(udDir, "engine-thumbnails");
  const newDir = path.join(outDir, "my-render-cache");
  fs.rmSync(newDir, { recursive: true, force: true });
  const ranges = async () => (await call("engineRenderedRanges")).map(([a, b]) => b - a).reduce((s, x) => s + x, 0);
  const chunks = (dir) => {
    const p = path.join(dir, "prerender");
    return fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f !== "index.json" && !f.endsWith(".part")) : [];
  };
  const waitFor = async (pred, seconds) => {
    for (let i = 0; i < seconds * 2; i++) {
      if (await pred()) return true;
      await win.waitForTimeout(500);
    }
    return false;
  };
  // An edit of the timeline: a split at the playhead, then undone (both change the clips).
  const edit = async () => {
    await win.locator("[data-testid=timeline]").click({ position: { x: 5, y: 5 } }).catch(() => {});
    for (let i = 0; i < 12; i++) await win.keyboard.press("ArrowRight");
    await win.keyboard.press("Meta+b");
    await win.waitForTimeout(400);
    await win.keyboard.press("Meta+z");
    await win.waitForTimeout(400);
  };
  const saveSettings = async () => {
    await win.locator("[data-testid=settings-save]").click();
    await win.waitForSelector("[data-testid=settings-window]", { state: "detached", timeout: 10000 });
    await win.waitForTimeout(500);
  };

  // ---- Off by default ----
  check("Auto render is off by default", (await prefsOf(win)).autoRender === false);
  await win.waitForTimeout(7000);
  check("nothing is rendered while it's off", (await ranges()) === 0 && chunks(defaultDir).length === 0);

  // ---- Turned on: the idle timeline renders by itself ----
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  check("the row has a live toggle with its note", !(await win.locator("[data-testid=settings-auto-render]").isDisabled()) && /Automatically render/.test(await win.locator("[data-testid=settings-row-autoRender]").innerText()));
  await win.locator("[data-testid=settings-auto-render]").click();
  await shot("ar1-settings");
  await saveSettings();
  check("saved in the preferences", (await prefsOf(win)).autoRender === true);
  const rendered = await waitFor(async () => (await ranges()) > 0 && chunks(defaultDir).length > 0, 150);
  check("the timeline was rendered by itself (ranges reported, chunk files written)", rendered, `${await ranges()} us, ${chunks(defaultDir).length} files`);
  const done = await waitFor(async () => !(await win.locator("[data-testid=render-pill]").count()), 120);
  const total1 = await ranges();
  const clipUs = await win.evaluate(() => +document.querySelector("[data-testid=player-time]").getAttribute("data-total") * 1e6);
  check("it covers the whole clip", done && total1 >= clipUs * 0.95, `${total1} of ${clipUs} us`);

  // ---- An edit interrupts; the render resumes when the editing pauses ----
  const before = chunks(defaultDir).length;
  await call("engineDeleteRenderCache");
  await win.waitForTimeout(800);
  check("clearing the cache empties the ranges", (await ranges()) === 0);
  await edit();
  const again = await waitFor(async () => (await ranges()) >= clipUs * 0.95, 150);
  check("after an edit it rendered again once idle", again, `${await ranges()} us (first time ${before} files)`);

  // ---- The location ----
  fs.writeFileSync(path.join(defaultDir, "carried.marker"), "x");
  await stubFolderPicker(app, newDir);
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  await win.waitForTimeout(500);
  check("the row shows the default folder", (await win.locator("[data-testid=settings-render-cache-path]").getAttribute("title")) === defaultDir);
  const ranges0 = await ranges();
  const files0 = chunks(defaultDir).length;
  await win.locator("[data-testid=settings-render-cache-path-pick]").click();
  await win.waitForTimeout(300);
  check("the picked folder shows", (await win.locator("[data-testid=settings-render-cache-path]").getAttribute("title")) === newDir);
  await shot("ar2-picker");
  await saveSettings();
  check("saved", (await prefsOf(win)).renderCacheDir === newDir);
  await waitFor(async () => chunks(newDir).length === files0 && files0 > 0 && chunks(defaultDir).length === 0 && !fs.existsSync(path.join(defaultDir, "carried.marker")), 60);
  check("the chunks and their index moved to the new folder", chunks(newDir).length === files0 && fs.existsSync(path.join(newDir, "prerender", "index.json")) && fs.existsSync(path.join(newDir, "carried.marker")), `${chunks(newDir).length}/${files0}`);
  check("and left the old one", chunks(defaultDir).length === 0 && !fs.existsSync(path.join(defaultDir, "carried.marker")));
  // The engine reads the chunks where they are now (it may take the next sync to show them).
  await edit();
  const kept = await waitFor(async () => (await ranges()) >= ranges0 * 0.95, 150);
  check("the rendered ranges are still there (read from the new folder)", kept, `${await ranges()} vs ${ranges0}`);
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  await win.waitForTimeout(600);
  const size = +(await win.locator("[data-testid=settings-render-cache-size]").getAttribute("data-bytes"));
  check("the size row counts the new folder", size > 100000 && (await win.locator("[data-testid=settings-render-cache-path]").getAttribute("title")) === newDir, String(size));
  // Default goes back.
  await win.locator("[data-testid=settings-render-cache-default]").click();
  await saveSettings();
  await waitFor(async () => chunks(defaultDir).length === files0 && chunks(newDir).length === 0, 60);
  check("Default moves them back", (await prefsOf(win)).renderCacheDir === "" && chunks(defaultDir).length === files0 && chunks(newDir).length === 0, `${chunks(defaultDir).length}/${files0} ${chunks(newDir).length} ${JSON.stringify((await prefsOf(win)).renderCacheDir)}`);

  // ---- Turned off: nothing new ----
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  await win.locator("[data-testid=settings-auto-render]").click();
  await saveSettings();
  await call("engineDeleteRenderCache");
  await edit();
  await win.waitForTimeout(9000);
  check("with it off an edit and the idle time render nothing", (await ranges()) === 0 && chunks(defaultDir).length === 0);
  return report();
};
