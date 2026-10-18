// Helpers for the Settings and Shortcuts windows: the preferences as the main process keeps
// them, the windows opened from the home screen and the editor, CapCut-style menus picked by
// value, a photo made with ffmpeg, and media imported and dropped on the timeline.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { goHome } from "./_preview.mjs";

/** The preferences (preload's getPreferences, exposed under its base64 name). */
export const prefsOf = (win) => win.evaluate(() => window[btoa("getPreferences")]());

export const settingsOpen = async (win) => (await win.locator("[data-testid=settings-window]").count()) > 0;

/** Settings from the home screen's gear menu. */
export const openSettingsFromHome = async (win) => {
  if (await win.locator("[data-testid=editor]").count()) await goHome(win);
  await win.locator("[data-testid=home-settings]").click();
  await win.locator("[data-testid=home-menu-settings]").click();
  await win.waitForSelector("[data-testid=settings-window]", { timeout: 5000 });
  await win.waitForTimeout(400);
};

/** Settings from the editor's top bar. */
export const openSettingsFromEditor = async (win) => {
  await win.locator("[data-testid=open-settings]").click();
  await win.waitForSelector("[data-testid=settings-window]", { timeout: 5000 });
  await win.waitForTimeout(400);
};

export const settingsTab = async (win, id) => {
  await win.locator(`[data-testid=settings-tab-${id}]`).click();
  await win.waitForSelector(`[data-testid=settings-panel-${id}]`);
  await win.waitForTimeout(150);
};

/** The rows of the open tab: id, whether disabled, and the label. */
export const rowsOf = (win) =>
  win.evaluate(() =>
    [...document.querySelectorAll("[data-testid=settings-window] [data-testid^=settings-row-]")].map((r) => ({
      id: r.getAttribute("data-testid").slice("settings-row-".length),
      disabled: r.getAttribute("data-disabled") === "true",
      note: !!r.querySelector("[data-testid=settings-not-yet]"),
      label: (r.firstElementChild?.textContent ?? "").trim(),
    })),
  );

/** Pick `value` in the menu `testId` (a Choice: its options carry data-value). */
export const choose = async (win, testId, value) => {
  await win.locator(`[data-testid=${testId}]`).click();
  await win.locator(`[data-testid=${testId}-option][data-value="${value}"]`).click();
  await win.waitForTimeout(150);
};

/** Type a number into a stepper and commit it. */
export const typeStepper = async (win, testId, value) => {
  const f = win.locator(`[data-testid=${testId}]`);
  await f.click({ clickCount: 3 });
  await f.fill(String(value));
  await f.press("Enter");
  await win.waitForTimeout(100);
};

export const saveSettings = async (win) => {
  await win.locator("[data-testid=settings-save]").click();
  await win.waitForSelector("[data-testid=settings-window]", { state: "detached", timeout: 10000 });
  await win.waitForTimeout(300);
};

export const cancelSettings = async (win) => {
  await win.locator("[data-testid=settings-cancel]").click();
  await win.waitForSelector("[data-testid=settings-window]", { state: "detached", timeout: 5000 });
  await win.waitForTimeout(200);
};

/** A 1280×720 photo, made once with the app's ffmpeg. */
export const photoFixture = (ctx) => {
  const file = path.join(ctx.outDir, "settings-photo.png");
  if (ctx.fs.existsSync(file)) return file;
  const ffmpeg = createRequire(path.join(ctx.appDir, "package.json"))("ffmpeg-static");
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=1", "-frames:v", "1", file]);
  return file;
};

/** Import `file` through the Media tab's button, the picker stubbed to return it. */
export const importFile = async (ctx, file) => {
  const { app, win } = ctx;
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, file);
  await win.locator("[data-testid=media-import]").first().click();
  const name = path.basename(file, path.extname(file));
  await win.getByText(name, { exact: false }).first().waitFor({ timeout: 30000 });
  await win.waitForTimeout(1500);
  return name;
};

/** Drag the media item named `name` onto the empty timeline. */
export const dropOnEmptyTimeline = async (win, name) => {
  const item = win.getByText(name, { exact: false }).first();
  const drop = win.getByText("Drag and drop media to start creating");
  const a = await item.boundingBox();
  const b = await drop.boundingBox();
  await win.mouse.move(a.x + a.width / 2, a.y - 60);
  await win.mouse.down();
  await win.mouse.move(a.x + a.width / 2 + 10, a.y - 50, { steps: 5 });
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await win.waitForTimeout(300);
  await win.mouse.up();
  await win.waitForTimeout(2500);
};

/** Choose a menu bar item by its label (searching submenus), as a click on it would. */
export const clickMenu = (app, label) =>
  app.evaluate(({ Menu, BrowserWindow }, label) => {
    const find = (items) => {
      for (const i of items) {
        if (i.label === label) return i;
        const f = i.submenu && find(i.submenu.items);
        if (f) return f;
      }
      return null;
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) return false;
    item.click(undefined, BrowserWindow.getAllWindows()[0]);
    return true;
  }, label);

/** A menu bar item's state by its label. */
export const menuItem = (app, label) =>
  app.evaluate(({ Menu }, label) => {
    const find = (items) => {
      for (const i of items) {
        if (i.label === label) return { label: i.label, enabled: i.enabled, accelerator: i.accelerator ?? null, submenu: i.submenu?.items.map((s) => s.label) ?? null };
        const f = i.submenu && find(i.submenu.items);
        if (f) return f;
      }
      return null;
    };
    return find(Menu.getApplicationMenu()?.items ?? []);
  }, label);

/** The app menu's items (macOS: the first menu). */
export const appMenuItems = (app) => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items[0]?.submenu?.items.filter((i) => i.type !== "separator").map((i) => i.label) ?? []);

/** Make the native folder picker return `dir`. */
export const stubFolderPicker = (app, dir) =>
  app.evaluate(({ ipcMain }, dir) => {
    ipcMain.removeHandler("settings:pick-folder");
    ipcMain.handle("settings:pick-folder", async () => dir);
  }, dir);

/** The player's times: the playhead's and the length's text, and their seconds. */
export const playerTimes = (win) =>
  win.evaluate(() => {
    const t = document.querySelector("[data-testid=player-time]");
    const spans = t ? [...t.querySelectorAll(":scope > span")] : [];
    return { now: spans[0]?.textContent ?? "", total: spans[2]?.textContent ?? "", nowS: +(t?.getAttribute("data-time") ?? 0), totalS: +(t?.getAttribute("data-total") ?? 0) };
  });
