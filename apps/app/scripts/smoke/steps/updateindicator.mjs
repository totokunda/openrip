// The update indicator on Home (docs/plan/capcut-ui-spec.md §6.2, shot `01-home/010-update-tooltip.png`;
// after `import`, any clip): an arrow-in-a-circle button left of the gear; hovered, a tooltip says
// "You're up to date" and "Your current version: <version>"; with an update found (the main
// process's updater state stubbed, and the event it sends) a dot on the icon and a tooltip naming
// the new version; a click downloads it (the stubbed handler is called), and once it's downloaded
// the tooltip says it's ready and a click restarts (the stubbed install is called); the same
// states the update toasts act on (hooks/use-update-toasts.ts).
// Shots: `ui1-current`, `ui2-available`, `ui3-ready`.
import { goHome } from "./_preview.mjs";
import { checks } from "./_anim.mjs";

export default async (ctx) => {
  const { win, app, shot } = ctx;
  const { check, report } = checks();
  await goHome(win);
  await win.waitForTimeout(800);
  const button = win.locator("[data-testid=home-update]");
  const tip = win.locator("[data-testid=home-update-tip]");
  const version = await win.evaluate(() => window[btoa("getAppInfo")]().then((i) => i.version));
  check("the indicator sits beside the gear", (await button.count()) === 1 && (await button.boundingBox()).x < (await win.locator("[data-testid=home-settings]").boundingBox()).x);
  check("no dot while there's nothing new", (await win.locator("[data-testid=home-update-dot]").count()) === 0);
  await button.hover();
  await win.waitForTimeout(300);
  const current = (await tip.innerText()).replace(/\s+/g, " ");
  check("the tooltip says you're up to date, with the current version", /You're up to date/.test(current) && current.includes(`Your current version: ${version}`), current);
  await shot("ui1-current");

  // An update found.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.__upd = { status: "available", updateInfo: { version: "9.9.9" }, calls: [] };
    ipcMain.removeHandler("app-update:get-state");
    ipcMain.handle("app-update:get-state", async () => ({ status: globalThis.__upd.status, updateInfo: globalThis.__upd.updateInfo }));
    ipcMain.removeHandler("app-update:download");
    ipcMain.handle("app-update:download", async () => {
      globalThis.__upd.calls.push("download");
      return { ok: true };
    });
    ipcMain.removeHandler("app-update:install");
    ipcMain.handle("app-update:install", async () => {
      globalThis.__upd.calls.push("install");
      return { ok: true };
    });
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("app-update:event", { type: "available", info: { version: "9.9.9" } });
  });
  await win.waitForTimeout(800);
  check("a dot shows on the icon", (await win.locator("[data-testid=home-update-dot]").count()) === 1);
  await button.hover();
  await win.waitForTimeout(300);
  const available = (await tip.innerText()).replace(/\s+/g, " ");
  check("the tooltip names the new version", /new version is available/i.test(available) && available.includes("9.9.9"), available);
  await shot("ui2-available");
  await button.click();
  await win.waitForTimeout(500);
  const calls = () => app.evaluate(() => globalThis.__upd.calls.join());
  check("a click downloads it", (await calls()) === "download", await calls());

  // Downloaded.
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__upd.status = "downloaded";
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("app-update:event", { type: "downloaded", info: { version: "9.9.9" } });
  });
  await win.waitForTimeout(800);
  await button.hover();
  await win.waitForTimeout(300);
  const ready = (await tip.innerText()).replace(/\s+/g, " ");
  check("once downloaded the tooltip says it's ready", /Update ready/.test(ready), ready);
  await shot("ui3-ready");
  await button.click();
  await win.waitForTimeout(500);
  check("a click restarts to install it", (await calls()) === "download,install", await calls());
  return report();
};
