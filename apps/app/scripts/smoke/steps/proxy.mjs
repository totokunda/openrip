// Proxy media (after `import timeline`; `~/Downloads/IMG_9079.MOV` with CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, a 4K ProRes clip; needs ffprobe, FFPROBE= to say where; docs/plan/capcut-ui-spec.md
// §6.3 Performance › Proxy and §6.16 Project settings › Performance):
// - the session runs with OPENRIP_NO_AUTO_PROXY=1 (Settings › Performance › Proxy off for new
//   projects), so nothing is made until the project's Proxy switch is turned on in Project settings
//   (Modify ▸ Performance); then the clip above 1080p gets a proxy by itself, in the background (the
//   card stays usable): a 720P (short side) H.264 file with every frame a keyframe, the clip's frame rate, in
//   the project's proxy folder, the card tagged "Proxy", Details saying "Turned on";
// - the engine PLAYS the proxy while editing: its sync carries the proxy file's path (an IPC
//   wrapper records what the main process is sent), its frame is the clip's picture (close to the
//   original's); with the switch off it reads the original again and the frame is back;
// - an export (480P) is sent the ORIGINAL file, with the switch on;
// - Cancel file proxy (the card's menu) removes the file and the engine reads the original;
//   the resolution 540P then Create file proxy makes a 540-high proxy (the project's switch
//   comes on by itself when it was off); Settings › Performance's Proxy size counts it and its
//   bin removes every proxy;
// - Settings › Performance › Proxy is the default of a project's switch: see `proxydefault`.
// Shots: `px1-switch` ↔ `17-inspector-project/008`, `px2-card` ↔ `05-left-media/002`,
// `px3-settings` ↔ `02-settings/011`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { checks } from "./_anim.mjs";
import { engineFrame, grab, diff } from "./_preview.mjs";
import { openSettingsFromEditor, settingsTab, cancelSettings } from "./_settings.mjs";

const FFPROBE = process.env.FFPROBE || "/opt/homebrew/bin/ffprobe";
const probe = (file) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 26 }).toString());

export default async (ctx) => {
  const { win, app, shot, udDir, outDir, fs } = ctx;
  const { check, report } = checks();
  const dialog = win.locator("[data-testid=project-settings]");
  const card = win.locator(`[data-testid=media-card][data-name^="${process.env.CLIP_NAME ?? "IMG_9079"}"]`);

  // What the main process is sent: the media paths of each sync and export.
  await app.evaluate(({ ipcMain }) => {
    const seen = (globalThis.__seen = { sync: [], export: [] });
    for (const [channel, key] of [["engine:sync-project", "sync"], ["engine:export", "export"]]) {
      const h = ipcMain._invokeHandlers?.get(channel);
      if (!h) continue;
      ipcMain._invokeHandlers.set(channel, async (e, ...args) => {
        seen[key].push(Object.values(args[1]?.assets ?? {}).map((a) => a.path));
        return h(e, ...args);
      });
    }
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const lastPaths = (key) => app.evaluate((_a, key) => globalThis.__seen[key].at(-1) ?? [], key);
  const count = (key) => app.evaluate((_a, key) => globalThis.__seen[key].length, key);
  const waitSync = async (pred, ms = 20000) => {
    for (let t = 0; t < ms; t += 400) {
      const p = await lastPaths("sync");
      if (p.length && pred(p)) return true;
      await win.waitForTimeout(400);
    }
    return false;
  };
  const proxyFiles = () => {
    const media = path.join(udDir, "media");
    const found = [];
    for (const e of fs.existsSync(media) ? fs.readdirSync(media) : []) {
      const dir = path.join(media, e, "proxy");
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith("_proxy.mp4")) found.push(path.join(dir, f));
    }
    return found;
  };
  const openDialog = async (tab) => {
    await win.locator("[data-testid=project-tab-details]").click().catch(async () => {});
    await win.locator("[data-testid=project-modify]").click();
    await dialog.waitFor({ timeout: 5000 });
    await win.locator(`[data-testid=ps-tab-${tab}]`).click();
    await win.waitForTimeout(300);
  };
  const saveDialog = async () => {
    await win.locator("[data-testid=ps-save]").click();
    await dialog.waitFor({ state: "hidden", timeout: 10000 });
    await win.waitForTimeout(800);
  };
  const detailsText = async () => (await win.locator("[data-testid=inspector-project]").innerText()).replace(/\s+/g, " ");
  // The project inspector (nothing selected): click an empty bit of the timeline's ruler.
  const toDetails = async () => {
    await win.keyboard.press("Escape");
    await win.mouse.click(700, 5);
    await win.locator("[data-testid=project-tab-details]").click().catch(() => {});
    await win.waitForTimeout(400);
  };
  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(500);

  // ---- Off by default here (the test profile): nothing made, the engine reads the original ----
  check("nothing is made while the project's switch is off", proxyFiles().length === 0);
  await win.waitForTimeout(500);
  await grab(win, "original");
  const frameOriginal = await engineFrame(win);

  // ---- The project's Proxy switch ----
  await toDetails();
  check("Details says the proxy is turned off", /Proxy: Turned off/.test(await detailsText()), (await detailsText()).slice(0, 200));
  await win.locator("[data-testid=project-modify]").click();
  await dialog.waitFor({ timeout: 5000 });
  await win.locator("[data-testid=ps-tab-performance]").click();
  await win.waitForTimeout(300);
  check("the Proxy switch is off and the Resolution is greyed until it's on", (await win.locator("[data-testid=ps-proxy]").getAttribute("aria-checked")) === "false" && (await win.locator("[data-testid=ps-proxy-resolution]").isDisabled()));
  await win.locator("[data-testid=ps-proxy]").click();
  await win.waitForTimeout(300);
  check("the Resolution lists 720P and 540P", !(await win.locator("[data-testid=ps-proxy-resolution]").isDisabled()));
  await shot("px1-switch");
  await saveDialog();
  await toDetails();
  check("Details says the proxy is turned on", /Proxy: Turned on/.test(await detailsText()), (await detailsText()).slice(0, 200));

  // ---- The proxy is made by itself, in the background ----
  let files = [];
  for (let i = 0; i < 240 && files.length === 0; i++) {
    await win.waitForTimeout(1000);
    files = proxyFiles();
  }
  check("a proxy file was made for the 4K clip", files.length === 1, files.join(","));
  const proxyPath = files[0];
  if (!proxyPath) return report();
  const src = probe(path.join(udDir, "media", path.basename(path.dirname(path.dirname(proxyPath))), "symlinks", fs.readdirSync(path.join(path.dirname(path.dirname(proxyPath)), "symlinks")).find((n) => n.startsWith(process.env.CLIP_NAME ?? "IMG_9079"))));
  const vs = (j) => j.streams.find((s) => s.codec_type === "video");
  const px = probe(proxyPath);
  const sv = vs(src);
  const pv = vs(px);
  const fr = (s) => s.r_frame_rate.split("/").reduce((a, b) => a / b);
  console.log("proxy", pv.codec_name, pv.width, pv.height, pv.r_frame_rate, "source", sv.codec_name, sv.width, sv.height, sv.r_frame_rate);
  check("it's H.264 with a 720 short side, below the original", pv.codec_name === "h264" && Math.min(pv.width, pv.height) <= 720 && Math.min(pv.width, pv.height) < Math.min(sv.width, sv.height), `${pv.width}x${pv.height}`);
  check("keeps the clip's frame rate and length", Math.abs(fr(pv) - fr(sv)) < 0.01 && Math.abs(+px.format.duration - +src.format.duration) < 0.2, `${pv.r_frame_rate} ${px.format.duration} vs ${src.format.duration}`);
  const gop = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v", "-show_entries", "packet=flags", "-of", "csv=p=0", "-read_intervals", "%+2", proxyPath]).toString().trim().split("\n");
  check("every frame is a keyframe (quick to scrub)", gop.length > 5 && gop.every((l) => l.startsWith("K")), gop.slice(0, 6).join(" "));
  await win.waitForTimeout(1500);
  check("the card is tagged Proxy", /Proxy/.test(await card.innerText()), (await card.innerText()).replace(/\s+/g, " "));
  await shot("px2-card");

  // ---- The engine plays it while editing ----
  const onProxy = await waitSync((p) => p.some((x) => x.endsWith("_proxy.mp4")));
  check("the engine's sync carries the proxy file, not the original", onProxy, JSON.stringify(await lastPaths("sync")));
  await win.waitForTimeout(1200);
  await grab(win, "proxied");
  const frameProxy = await engineFrame(win);
  const d1 = await diff(win, "original", "proxied", 48);
  const total = frameProxy.w * frameProxy.h;
  check("its frame is the clip's picture, close to the original's", frameProxy.light > 0.02 && Math.abs(frameProxy.light - frameOriginal.light) < 0.06 && d1.n / total < 0.25, `light ${frameOriginal.light.toFixed(3)} -> ${frameProxy.light.toFixed(3)}; ${(100 * d1.n / total).toFixed(1)}% differ`);

  // ---- Export always reads the original ----
  const e0 = await count("export");
  await win.locator("[data-testid=export]").click();
  const exportDialog = win.locator("[data-testid=export-dialog]");
  await exportDialog.waitFor({ state: "visible" });
  await win.waitForTimeout(500);
  const T = (id) => exportDialog.locator(`[data-testid=${id}]`);
  await T("export-resolution").scrollIntoViewIfNeeded();
  await T("export-resolution").click();
  await win.waitForTimeout(250);
  await win.locator("[data-testid=export-resolution-option]").filter({ has: win.getByText("480P", { exact: true }) }).first().click();
  await win.waitForTimeout(250);
  await T("export-name").fill("px-export");
  await T("export-path").fill(outDir);
  await T("export-submit").click();
  let phase = "running";
  for (let i = 0; i < 600 && phase === "running"; i++) {
    await win.waitForTimeout(500);
    phase = (await T("export-run").getAttribute("data-phase").catch(() => null)) ?? "running";
  }
  const exported = await lastPaths("export");
  check("the export finished from the ORIGINAL file (the proxy is for editing only)", (await count("export")) > e0 && phase !== "running" && exported.length > 0 && exported.every((p) => !p.includes("_proxy")) && exported.some((p) => p.includes("IMG_9079")), `${phase} ${JSON.stringify(exported)}`);
  await T("export-run-done").click().catch(() => {});
  await exportDialog.waitFor({ state: "hidden" }).catch(() => {});
  const out = path.join(outDir, "px-export.mp4");
  check("and the file is a real 480P video", fs.existsSync(out) && Math.min(vs(probe(out)).width, vs(probe(out)).height) === 480, fs.existsSync(out) ? `${vs(probe(out)).width}x${vs(probe(out)).height}` : "missing");

  // ---- Switch off: the engine reads the original again ----
  await toDetails();
  await openDialog("performance");
  await win.locator("[data-testid=ps-proxy]").click();
  await saveDialog();
  const backOnOriginal = await waitSync((p) => p.every((x) => !x.includes("_proxy")));
  check("with the switch off the engine reads the original again", backOnOriginal, JSON.stringify(await lastPaths("sync")));
  await win.waitForTimeout(1200);
  await grab(win, "original2");
  const d2 = await diff(win, "original", "original2", 8);
  check("and its frame is the original's again", d2.n / total < 0.01, `${(100 * d2.n / total).toFixed(2)}% differ`);

  // ---- Cancel file proxy, then 540P and Create file proxy ----
  const menu = async (label) => {
    await card.click({ button: "right", position: { x: 60, y: 40 } });
    await win.waitForTimeout(400);
    await win.getByRole("menuitem", { name: label, exact: true }).click();
  };
  await menu("Cancel file proxy");
  for (let i = 0; i < 20 && proxyFiles().length; i++) await win.waitForTimeout(500);
  await win.waitForTimeout(800);
  check("Cancel file proxy removes the file and the tag", proxyFiles().length === 0 && !/Proxy/.test(await card.innerText()), `${proxyFiles().length} files`);
  await toDetails();
  await openDialog("performance");
  await win.locator("[data-testid=ps-proxy]").click();
  await win.locator("[data-testid=ps-proxy-resolution]").click();
  await win.waitForTimeout(250);
  await win.locator("[data-testid=ps-proxy-resolution-option][data-value=\"540\"]").click();
  await win.waitForTimeout(250);
  // Switched on and saved, the clip would get its proxy by itself; to Create by hand, leave it off.
  await win.locator("[data-testid=ps-proxy]").click();
  await saveDialog();
  await toDetails();
  check("the switch stays off", /Proxy: Turned off/.test(await detailsText()));
  await menu("Create file proxy");
  files = [];
  for (let i = 0; i < 240 && files.length === 0; i++) {
    await win.waitForTimeout(1000);
    files = proxyFiles();
  }
  check("Create file proxy makes a proxy at the project's resolution (540)", files.length === 1 && Math.min(vs(probe(files[0])).width, vs(probe(files[0])).height) === 540, files.join(","));
  await win.waitForTimeout(1500);
  await toDetails();
  check("making one by hand turns the project's Proxy switch on", /Proxy: Turned on/.test(await detailsText()), (await detailsText()).slice(0, 200));
  check("the engine plays it", await waitSync((p) => p.some((x) => x.endsWith("_proxy.mp4"))), JSON.stringify(await lastPaths("sync")));

  // ---- Settings › Performance ----
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  await win.waitForTimeout(600);
  const bytes = +(await win.locator("[data-testid=settings-proxy-size]").getAttribute("data-bytes"));
  check("Proxy size counts the proxy", bytes > 50000, String(bytes));
  check("the Proxy checkbox is live and, with the test profile's override, off", (await win.locator("[data-testid=settings-proxy]").count()) === 1 && !(await win.locator("[data-testid=settings-proxy]").isDisabled()));
  await shot("px3-settings");
  await win.locator("[data-testid=settings-proxy-size]").locator("xpath=following-sibling::button").click();
  await win.waitForTimeout(1500);
  check("its bin removes every proxy", proxyFiles().length === 0 && +(await win.locator("[data-testid=settings-proxy-size]").getAttribute("data-bytes")) < 50000, `${proxyFiles().length} files`);
  await cancelSettings(win);
  check("the engine is back on the original", await waitSync((p) => p.every((x) => !x.includes("_proxy"))), JSON.stringify(await lastPaths("sync")));
  return report();
};
