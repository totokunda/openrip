// Drive the built app step by step with Playwright, on a throwaway profile:
//   node session.mjs <appDir> <outDir> <userDataDir> <clip> <step...>
// Each step is steps/<name>.mjs; its default export gets { app, win, shot, clock, logs, clipPath,
// outDir, udDir, fs } and returns a line for the log; steps can leave values on it for later
// ones. The renderer's warnings, errors and page errors (with stacks) go to <outDir>/logs.txt.
// EXE=<binary> runs a packaged build.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { openEditor } from "./steps/_preview.mjs";
// Absolute paths: the app doesn't open projects in a profile given by a relative path.
const [appDir, outDir, udDir, clipPath, ...steps] = process.argv.slice(2).map((a, i) => (i < 3 ? path.resolve(a) : a));
fs.mkdirSync(outDir, { recursive: true });
const require = createRequire(appDir + "/package.json");
const { _electron: electron } = require("playwright");
const logs = [];
// Launch the app on the profile, maximized and settled. Steps can start it again on the same
// profile with ctx.relaunch() (after a change that must outlive a restart).
const launch = async () => {
  const app = await electron.launch({
    executablePath: process.env.EXE || require("electron"),
    args: [process.env.ENTRY ? appDir + "/packages/entry-point.mjs" : appDir, `--user-data-dir=${udDir}`],
    // The media root ignores --user-data-dir; without this, previews land in the real profile.
    env: { ...process.env, APEX_USER_DATA_DIR: udDir },
  });
  app.process().stderr.on("data", (d) => logs.push("[main:err] " + d.toString().trim()));
  const win = await app.firstWindow();
  win.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`[renderer:${m.type()}] ${m.text().slice(0, 300)}`); });
  win.on("pageerror", (e) => logs.push("[pageerror] " + (e.stack || e.message).slice(0, 1500)));
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(5000);
  // Maximized, as the app starts itself: with several sessions at once a window can stay small.
  // Wait until it is, and its size has settled, since steps measure the layout.
  const maximized = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize());
  for (let i = 0; i < 20 && !(await maximized()); i++) await win.waitForTimeout(500);
  for (let last = "", i = 0; i < 20; i++) {
    await win.waitForTimeout(500);
    const size = await win.evaluate(() => `${innerWidth}x${innerHeight}`);
    if (size === last) break;
    last = size;
  }
  return { app, win };
};
const { app, win } = await launch();
const shot = (n) => globalThis.ctx.win.screenshot({ path: `${outDir}/${n}.png` });
// The app opens on its home screen: steps start in the editor, on the project the app had
// open last (as it used to open straight into it). STAY_HOME=1 starts on the home screen.
if (!process.env.STAY_HOME) await openEditor(win);
// The player's time over the project's length, as "MM:SS.ss/MM:SS.ss" (the player shows
// HH:MM:SS:FF; its element carries both in seconds).
const clock = async () => {
  const t = globalThis.ctx.win.locator("[data-testid=player-time]");
  if (!(await t.count())) return undefined;
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  return `${mmss(+(await t.getAttribute("data-time")))}/${mmss(+(await t.getAttribute("data-total")))}`;
};
globalThis.ctx = { app, win, shot, clock, logs, clipPath, outDir, udDir, fs, appDir };
// Quit and start again on the same profile (on its home screen); ctx.app and ctx.win follow.
globalThis.ctx.relaunch = async () => {
  await globalThis.ctx.app.close().catch(() => {});
  const next = await launch();
  globalThis.ctx.app = next.app;
  globalThis.ctx.win = next.win;
  return next;
};
for (const step of steps) {
  const mod = await import(`./steps/${step}.mjs?${Date.now()}`);
  try {
    const r = await mod.default(globalThis.ctx);
    console.log(`STEP ${step}: ok`, r ?? "");
  } catch (e) {
    console.log(`STEP ${step}: FAILED`, e.message.split("\n")[0]);
    // The window may be gone (the app crashed): keep going to write the logs.
    await shot(`fail-${step}`).catch(() => {});
    break;
  }
}
fs.writeFileSync(`${outDir}/logs.txt`, logs.join("\n"));
const noise = /sandbox_extension|Security Warning|unsafe-eval|deprecated|viewport store not ready/;
console.log("LOGS:\n" + logs.filter((l) => !noise.test(l)).slice(0, 400).join("\n"));
await globalThis.ctx.app.close().catch(() => {});
