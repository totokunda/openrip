// The Settings window (CapCut's: Draft, Edit, Performance, General; Cancel and Save), from the
// home screen's gear and from the editor's top bar: every tab's rows (the disabled ones with a
// note, CapCut's cloud rows absent), the home menu's notices and About; then a change
// cancelled leaves everything as it was, and saved changes act: a new project at the frame rate
// chosen, a photo dropped at the image duration chosen, the player's times in the time code
// chosen (and back, live), ⇧→ stepping the frames chosen, ⇧↑ in a value field the units chosen;
// then a restart on the same profile keeps them all. Run on a fresh profile (STAY_HOME or not).
import { checks } from "./_anim.mjs";
import { openTab, field } from "./_undo.mjs";
import { openEditor, goHome } from "./_preview.mjs";
import {
  appMenuItems,
  cancelSettings,
  choose,
  clickMenu,
  menuItem,
  stubFolderPicker,
  dropOnEmptyTimeline,
  importFile,
  openSettingsFromEditor,
  openSettingsFromHome,
  photoFixture,
  playerTimes,
  prefsOf,
  rowsOf,
  saveSettings,
  settingsTab,
  typeStepper,
} from "./_settings.mjs";

const EXPECTED = {
  draft: { on: ["saveTo", "cache", "cacheSize"], off: ["screenRecording", "presetPath"] },
  edit: { on: ["stepMany", "adjustMany", "imageDuration", "targetLoudness", "frameRate", "timeCode", "exportSound"], off: ["scrubAudio", "linkage", "arrangeLayers"] },
  performance: { on: ["encodeDecode", "autoOptimization", "proxyPath", "proxySize", "engine"], off: ["proxy", "renderCache", "renderCacheSize", "autoClear", "autoRender"] },
  general: { on: ["language", "notification", "update"], off: [] },
};
// CapCut's rows that need its cloud or an account.
const LEFT_OUT = /Download to|Auto sync|Synced items|Default space|Size limit|Dreamina/;

export default async (ctx) => {
  const { check, report } = checks();
  let win = ctx.win;
  const near = (a, b, tol = 0.002) => Math.abs(a - b) < tol;

  // ---- From the home screen: the gear's menu ----
  if (await win.locator("[data-testid=editor]").count()) await goHome(win);
  await win.locator("[data-testid=home-settings]").click();
  await win.waitForTimeout(300);
  const menu = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=home-menu-]")].map((e) => e.textContent.trim()));
  await ctx.shot("set-01-home-menu");
  check("the home gear's menu: Settings, Third-party copyright, Version", menu.length === 3 && menu[0] === "Settings" && menu[1] === "Third-party copyright" && /^Version \(\d+\.\d+\.\d+\)$/.test(menu[2]), menu.join(" | "));
  await win.locator("[data-testid=home-menu-notices]").click();
  await win.waitForSelector("[data-testid=notices-license]", { timeout: 10000 });
  const notices = await win.evaluate(() => ({
    sections: document.querySelectorAll("[data-testid=notices-license]").length,
    packages: +(document.querySelector("[data-testid=notices-page]")?.getAttribute("data-packages") ?? 0),
    text: document.querySelector("[data-testid=notices-page]")?.innerText ?? "",
  }));
  await ctx.shot("set-02-notices");
  check(
    "Third-party copyright lists OpenRip's npm and Cargo packages with their licences",
    notices.sections > 20 && notices.packages > 200 && /\(npm\)/.test(notices.text) && /\(Cargo\)/.test(notices.text) && /react /.test(notices.text) && /wgpu/.test(notices.text) && !/CapCut|ByteDance/.test(notices.text),
    `${notices.sections} licence texts, ${notices.packages} packages`,
  );
  await win.locator("[data-testid=notices-close]").click();
  await win.locator("[data-testid=home-settings]").click();
  await win.locator("[data-testid=home-menu-version]").click();
  await win.waitForSelector("[data-testid=about-window]");
  await win.waitForTimeout(500);
  const about = await win.locator("[data-testid=about-window]").innerText();
  await ctx.shot("set-03-about");
  check("Version opens About: the name, version and copyright", /OpenRip/.test(about) && /v\d+\.\d+\.\d+/.test(about) && /Copyright ©/.test(about) && !/CapCut/.test(about), about.replace(/\s+/g, " ").slice(0, 120));
  await win.locator("[data-testid=about-close]").click();
  await win.waitForTimeout(300);

  // ---- The menu bar's app menu (CapCut's: About, Settings, Back to home page, Layout, More, Quit) ----
  const items = await appMenuItems(ctx.app);
  const back = await menuItem(ctx.app, "Back to home page");
  const layoutMenu = await menuItem(ctx.app, "Layout");
  const more = await menuItem(ctx.app, "More");
  check(
    "the app menu: About, Settings, Back to home page (off on the home screen), Layout ▸, More ▸ Third-party Copyright, Quit",
    JSON.stringify(items) === JSON.stringify(["About", "Settings", "Back to home page", "Layout", "More", "Quit"]) &&
      back?.enabled === false &&
      JSON.stringify(layoutMenu?.submenu) === JSON.stringify(["Default", "Media", "Inspector", "Vertical", "Reset current layout"]) &&
      JSON.stringify(more?.submenu) === JSON.stringify(["Third-party Copyright"]),
    `${items.join(", ")}; back ${back?.enabled}; layout ${layoutMenu?.submenu}; more ${more?.submenu}`,
  );
  const opened = {};
  for (const [label, testId] of [
    ["Settings", "settings-window"],
    ["About", "about-window"],
    ["Third-party Copyright", "notices-window"],
  ]) {
    await clickMenu(ctx.app, label);
    await win.waitForTimeout(500);
    opened[label] = (await win.locator(`[data-testid=${testId}]`).count()) === 1;
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);
  }
  check("the menu bar's Settings, About and Third-party Copyright open their windows", Object.values(opened).every(Boolean), JSON.stringify(opened));

  // ---- Every tab and row ----
  await openSettingsFromHome(win);
  const title = await win.locator("[data-testid=settings-window] h2").first().innerText().catch(() => "");
  const box = await win.locator("[data-testid=settings-window]").boundingBox();
  check("Settings opens from the home screen, 510 wide", title === "Settings" && Math.abs(box.width - 510) < 2, `"${title}" ${box.width}×${box.height}`);
  for (const id of ["draft", "edit", "performance", "general"]) {
    await settingsTab(win, id);
    const rows = await rowsOf(win);
    const ids = rows.map((r) => r.id);
    const { on, off } = EXPECTED[id];
    const missing = [...on, ...off].filter((r) => !ids.includes(r));
    const wrong = rows.filter((r) => off.includes(r.id) !== r.disabled).map((r) => r.id);
    const noNote = rows.filter((r) => r.disabled && !r.note && !["renderCache", "renderCacheSize", "autoClear"].includes(r.id)).map((r) => r.id);
    const panel = await win.locator(`[data-testid=settings-panel-${id}]`).innerText();
    check(
      `${id}: its rows in order, the ones OpenRip can't do yet disabled with a note, no cloud rows`,
      missing.length === 0 && wrong.length === 0 && noNote.length === 0 && !LEFT_OUT.test(panel),
      `${ids.join(", ")}${missing.length ? `; missing ${missing}` : ""}${wrong.length ? `; wrong state ${wrong}` : ""}${noNote.length ? `; no note ${noNote}` : ""}`,
    );
    await ctx.shot(`set-1-${id}`);
  }
  // The menus, for the shots CapCut has of them.
  await settingsTab(win, "draft");
  await win.locator("[data-testid=settings-cache-age]").click();
  await ctx.shot("set-1-draft-cache-age");
  await win.keyboard.press("Escape");
  await settingsTab(win, "edit");
  for (const [testId, name] of [
    ["settings-loudness", "target-loudness"],
    ["settings-frame-rate", "frame-rate"],
    ["settings-time-code", "time-code"],
    ["settings-image-unit", "image-unit"],
  ]) {
    await win.locator(`[data-testid=${testId}]`).click();
    await win.waitForTimeout(200);
    if (testId === "settings-frame-rate") {
      const rates = await win.locator("[data-testid=settings-frame-rate-option]").allInnerTexts();
      check("Frame rate offers CapCut's rates", rates.map((r) => r.trim()).join(",") === "24.00 fps,25.00 fps,29.97 fps,30.00 fps,50.00 fps,59.94 fps,60.00 fps", rates.join(","));
    }
    if (testId === "settings-time-code") {
      const styles = await win.locator("[data-testid=settings-time-code-option]").allInnerTexts();
      check("Time code offers HH:MM:SS+frame and HH:MM:SS:FF", styles.map((r) => r.trim()).join(",") === "HH:MM:SS+frame,HH:MM:SS:FF", styles.join(","));
    }
    await ctx.shot(`set-1-edit-${name}`);
    await win.keyboard.press("Escape");
    await win.waitForTimeout(150);
  }
  await settingsTab(win, "performance");
  await win.locator("[data-testid=settings-auto-opt]").click();
  await ctx.shot("set-1-performance-auto-opt");
  await win.keyboard.press("Escape");

  // ---- Cancel changes nothing ----
  const before = await prefsOf(win);
  await settingsTab(win, "edit");
  await choose(win, "settings-frame-rate", "29.97");
  await choose(win, "settings-time-code", "ff");
  await typeStepper(win, "settings-step-frames", 7);
  await settingsTab(win, "general");
  await win.locator("[data-testid=settings-notifications]").click();
  await cancelSettings(win);
  const afterCancel = await prefsOf(win);
  await openSettingsFromHome(win);
  await settingsTab(win, "edit");
  const shown = await win.locator("[data-testid=settings-frame-rate]").innerText();
  const step = await win.locator("[data-testid=settings-step-frames]").inputValue();
  check(
    "Cancel: nothing saved, and the window shows the saved values again",
    JSON.stringify(afterCancel) === JSON.stringify(before) && shown.trim() === "24.00 fps" && step === "10",
    `frame rate ${shown.trim()}, step ${step}, prefs unchanged ${JSON.stringify(afterCancel) === JSON.stringify(before)}`,
  );

  // ---- Save: the changes act ----
  await choose(win, "settings-frame-rate", "29.97");
  await choose(win, "settings-time-code", "ff");
  await typeStepper(win, "settings-step-frames", 5);
  await typeStepper(win, "settings-adjust-units", 5);
  await typeStepper(win, "settings-image-duration", 40);
  await win.locator("[data-testid=settings-export-sound]").click();
  await settingsTab(win, "draft");
  await win.locator("[data-testid=settings-cache-auto]").click();
  await choose(win, "settings-cache-age", "15");
  await settingsTab(win, "general");
  await win.locator("[data-testid=settings-update-notify]").click();
  await ctx.shot("set-2-before-save");
  await saveSettings(win);
  const saved = await prefsOf(win);
  check(
    "Save keeps every change",
    saved.frameRate === 29.97 && saved.timeCode === "ff" && saved.stepFrames === 5 && saved.adjustUnits === 5 && saved.imageDuration === 40 && saved.imageDurationUnit === "s" && saved.exportSound === true && saved.cacheAutoDelete === true && saved.cacheMaxAgeDays === 15 && saved.autoUpdate === false,
    JSON.stringify({ ...saved, shortcutPresets: undefined }),
  );

  // A new project takes the frame rate.
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 30000 });
  await win.waitForTimeout(2500);
  const details = await win.locator("[data-testid=inspector-project]").innerText().catch(() => "");
  check("a new project has the frame rate chosen (29.97)", /Frame rate:\s*29\.97fps/.test(details), (/Frame rate:\s*\S+/.exec(details) ?? [""])[0]);

  // The inspector's Modify opens the project's own settings (its frame rate).
  await win.locator("[data-testid=project-modify]").click();
  await win.waitForTimeout(400);
  const projectDialog = await win.locator("[data-testid=project-settings]").innerText().catch(() => "");
  check("the inspector's Modify opens the project's settings at its frame rate", /Project settings/.test(projectDialog) && /29\.97 fps/.test(projectDialog), projectDialog.replace(/\s+/g, " ").slice(0, 80));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // A photo is as long as the image duration: 40 s at 29.97 fps is 1199 frames.
  const name = await importFile(ctx, photoFixture(ctx));
  await dropOnEmptyTimeline(win, name);
  let t = await playerTimes(win);
  check("a photo dropped on the timeline lasts the image duration (40 s)", near(t.totalS, 1199 / 29.97, 0.01), `${t.totalS.toFixed(3)} s`);
  // HH:MM:SS:FF counts at 30: 1199 frames are 39 s and 29 frames.
  check("the player's time in HH:MM:SS:FF", t.total === "00:00:39:29", t.total);
  await ctx.shot("set-3-photo-ff");

  // In the editor the menu bar's Back to home page works; its Layout ▸ Media picks the layout.
  const backInEditor = await menuItem(ctx.app, "Back to home page");
  const layoutId = () => win.evaluate(() => JSON.parse(localStorage.getItem("openrip:layout-config") ?? "{}")?.state?.layout ?? null);
  await clickMenu(ctx.app, "Media");
  await win.waitForTimeout(800);
  const layoutMedia = await layoutId();
  await clickMenu(ctx.app, "Default");
  await win.waitForTimeout(800);
  const layoutDefault = await layoutId();
  check("in the editor, Back to home page is on and Layout ▸ picks a layout", backInEditor?.enabled === true && layoutMedia === "media" && layoutDefault === "default", `back ${backInEditor?.enabled}; Media → ${layoutMedia}; Default → ${layoutDefault}`);

  // From the editor's top bar, back to HH:MM:SS+frame: the player follows at once. First a
  // thumbnail and a kept export in the cache folders, for the bin to clear.
  const seeded = [`${ctx.udDir}/engine-thumbnails/settings-check.bin`, `${ctx.udDir}/apex-export-cache/settings-check.mp4`];
  for (const f of seeded) {
    ctx.fs.mkdirSync(f.slice(0, f.lastIndexOf("/")), { recursive: true });
    ctx.fs.writeFileSync(f, Buffer.alloc(8192, 1));
  }
  await openSettingsFromEditor(win);
  check("Settings opens from the editor", await win.locator("[data-testid=settings-window]").isVisible(), "");
  // The cache (the photo's timeline thumbnails, at least) and its bin.
  await settingsTab(win, "draft");
  await win.waitForTimeout(500);
  const cache0 = +((await win.locator("[data-testid=settings-cache-size]").getAttribute("data-bytes")) ?? -1);
  await win.locator("[data-testid=settings-cache-size-clear]").click();
  await win.waitForTimeout(800);
  const cache1 = +((await win.locator("[data-testid=settings-cache-size]").getAttribute("data-bytes")) ?? -1);
  const gone = seeded.every((f) => !ctx.fs.existsSync(f));
  check("Cache size counts the cache and the bin clears it", cache0 >= 16384 && cache1 === 0 && gone, `${cache0} → ${cache1} bytes; files gone ${gone}`);
  await settingsTab(win, "edit");
  await choose(win, "settings-time-code", "frame");
  await saveSettings(win);
  t = await playerTimes(win);
  check("…and in HH:MM:SS+frame (the clock's seconds, then the frame)", t.total === "00:00:40:00", t.total);

  // ⇧→ steps the frames chosen (5).
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Home");
  await win.waitForTimeout(300);
  await win.keyboard.press("Shift+ArrowRight");
  await win.waitForTimeout(500);
  t = await playerTimes(win);
  check("⇧→ steps forward the frames chosen (5)", near(t.nowS, 5 / 29.97), `${t.nowS.toFixed(4)} s (${t.now})`);
  await win.keyboard.press("Shift+ArrowLeft");
  await win.waitForTimeout(400);
  t = await playerTimes(win);
  check("⇧← steps back as many", near(t.nowS, 0), `${t.nowS.toFixed(4)} s`);

  // ⇧↑ in a value field moves the units chosen (5 steps).
  const clipY = await win.evaluate(() => {
    const root = document.querySelector("[data-testid=timeline]");
    const c = [...(root?.querySelectorAll("canvas") ?? [])].map((e) => e.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return c ? { x: c.x + 140, y: c.y + 27 + 40 } : null;
  });
  let adjust = "no field";
  try {
    await win.keyboard.press("Meta+a");
    await win.waitForTimeout(500);
    await openTab(win, "Adjust");
    const f = field(win, "Brightness");
    await f.scrollIntoViewIfNeeded();
    await f.click();
    const v0 = Number(await f.inputValue());
    await f.press("ArrowUp");
    await win.waitForTimeout(300);
    const v1 = Number(await f.inputValue());
    await f.press("Shift+ArrowUp");
    await win.waitForTimeout(300);
    const v2 = Number(await f.inputValue());
    adjust = `${v0} → ${v1} (↑) → ${v2} (⇧↑)`;
    check("⇧↑ in a value field adds the units chosen (5 steps), ↑ one", v1 - v0 > 0 && near(v2 - v1, 5 * (v1 - v0), 1e-6), adjust);
    await f.press("Escape");
  } catch (e) {
    check("⇧↑ in a value field adds the units chosen (5 steps), ↑ one", false, `${adjust}: ${e.message.split("\n")[0]} ${JSON.stringify(clipY)}`);
  }
  await win.evaluate(() => document.activeElement?.blur?.());

  // ---- Draft › Save to: the projects move to another folder ----
  const fsx = ctx.fs;
  const projectFiles = (dir) => (fsx.existsSync(dir) ? fsx.readdirSync(dir).filter((f) => /^project-\d+\.json$/.test(f)) : []);
  const defaultDir = `${ctx.udDir}/projects-json`;
  const movedDir = `${ctx.outDir}/moved-projects`;
  fsx.rmSync(movedDir, { recursive: true, force: true });
  const filesBefore = projectFiles(defaultDir);
  await stubFolderPicker(ctx.app, movedDir);
  await openSettingsFromEditor(win);
  await settingsTab(win, "draft");
  await win.locator("[data-testid=settings-save-to-pick]").click();
  await win.waitForTimeout(300);
  const shownDir = await win.locator("[data-testid=settings-save-to]").getAttribute("title");
  await saveSettings(win);
  await win.waitForTimeout(1500);
  check(
    "Save to: the projects move to the folder chosen",
    shownDir === movedDir && filesBefore.length >= 2 && projectFiles(movedDir).length === filesBefore.length && projectFiles(defaultDir).length === 0,
    `${filesBefore.length} files; there now ${projectFiles(movedDir).length}, left ${projectFiles(defaultDir).length}`,
  );

  // ---- A restart keeps them ----
  // Cache files 20 days old and new: Auto delete cache from 15 days ago clears the old one at start.
  const oldFile = `${ctx.udDir}/engine-thumbnails/old-thumb.bin`;
  const newFile = `${ctx.udDir}/engine-thumbnails/new-thumb.bin`;
  ctx.fs.mkdirSync(`${ctx.udDir}/engine-thumbnails`, { recursive: true });
  ctx.fs.writeFileSync(oldFile, Buffer.alloc(1024, 1));
  ctx.fs.writeFileSync(newFile, Buffer.alloc(1024, 1));
  const twentyDaysAgo = (Date.now() - 20 * 24 * 3600 * 1000) / 1000;
  ctx.fs.utimesSync(oldFile, twentyDaysAgo, twentyDaysAgo);
  await win.waitForTimeout(1500);
  ({ win } = await ctx.relaunch());
  await win.waitForTimeout(1000);
  check("Auto delete cache from 15 days ago: at start the 20-day-old cache file goes, a new one stays", !ctx.fs.existsSync(oldFile) && ctx.fs.existsSync(newFile), `old there ${ctx.fs.existsSync(oldFile)}, new there ${ctx.fs.existsSync(newFile)}`);
  await win.waitForSelector("[data-testid=home], [data-testid=editor]", { timeout: 60000 });
  await openSettingsFromHome(win);
  const kept = await prefsOf(win);
  await settingsTab(win, "edit");
  const ui = {
    fps: (await win.locator("[data-testid=settings-frame-rate]").innerText()).trim(),
    tc: (await win.locator("[data-testid=settings-time-code]").innerText()).trim(),
    step: await win.locator("[data-testid=settings-step-frames]").inputValue(),
    image: await win.locator("[data-testid=settings-image-duration]").inputValue(),
    sound: await win.locator("[data-testid=settings-export-sound]").getAttribute("aria-checked"),
  };
  await settingsTab(win, "draft");
  ui.cache = await win.locator("[data-testid=settings-cache-auto]").getAttribute("aria-checked");
  ui.age = (await win.locator("[data-testid=settings-cache-age]").innerText()).trim();
  await settingsTab(win, "general");
  ui.update = await win.locator("[data-testid=settings-update-notify]").getAttribute("aria-checked");
  await ctx.shot("set-4-after-restart");
  check(
    "after a restart on the same profile the settings are as saved",
    kept.frameRate === 29.97 && kept.timeCode === "frame" && kept.stepFrames === 5 && kept.imageDuration === 40 && ui.fps === "29.97 fps" && ui.tc === "HH:MM:SS+frame" && ui.step === "5" && ui.image === "40.0" && ui.sound === "true" && ui.cache === "true" && ui.age === "15" && ui.update === "true",
    JSON.stringify(ui),
  );
  await settingsTab(win, "draft");
  const keptDir = await win.locator("[data-testid=settings-save-to]").getAttribute("title");
  const cards = await win.locator("[data-testid=project-card]").count();
  check("after the restart the projects are read from the folder chosen", keptDir === movedDir && cards === filesBefore.length, `${keptDir}; ${cards} projects listed`);

  // Back to the profile's folder, so later steps find the projects where they look.
  await stubFolderPicker(ctx.app, defaultDir);
  await win.locator("[data-testid=settings-save-to-pick]").click();
  await saveSettings(win);
  await win.waitForTimeout(1500);
  check("…and they move back", projectFiles(defaultDir).length === filesBefore.length && projectFiles(movedDir).length === 0, `${projectFiles(defaultDir).length} back`);
  await openEditor(win);
  return report();
};
