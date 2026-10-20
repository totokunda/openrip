// The media card menu's Export selected clips (after `import`, nothing on the timeline;
// CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1, built app, no dev server; FFmpeg from ffmpeg-static
// makes a photo, ffprobe reads the files back): a video card with an In/Out range and a photo
// card selected, the menu item on one of them opening the Export dialog on "Selected media"
// with one file per card named after it; 480P video with sound, GIF and the extra parts off;
// the video's file as long as its range (not the whole video) and in the card's own picture
// shape, the photo a still of the image duration; nothing added to the timeline; a single card
// without a selection exports by itself; a sound card writes just its audio.
// Shots: `ce1-menu` ↔ `05-left-media/006-media-item-context-menu`, `ce2-dialog`, `ce3-done`.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { checks, savedProject } from "./_anim.mjs";

const FFPROBE = process.env.FFPROBE || "/opt/homebrew/bin/ffprobe";
const probe = (file) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 26 }).toString());
const stream = (info, type) => info.streams.find((s) => s.codec_type === type);

export default async (ctx) => {
  const { win, udDir, shot, outDir, appDir, app, fs } = ctx;
  const { check, report } = checks();
  const require = createRequire(appDir + "/package.json");
  const card = (name) => win.locator(`[data-testid=media-card][data-name^="${name}"]`);
  const videoName = process.env.CLIP_NAME ?? "IMG_9079";
  const dialog = win.locator("[data-testid=export-dialog]");
  const T = (id) => dialog.locator(`[data-testid=${id}]`);
  const dest = path.join(outDir, "card-export");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(800);
  const png = path.join(outDir, "card-photo.png");
  execFileSync(require("ffmpeg-static"), ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=640x360", "-frames:v", "1", png]);
  const wav = path.join(outDir, "card-tone.wav");
  execFileSync(require("ffmpeg-static"), ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", wav]);
  for (const f of [png, wav]) {
    await app.evaluate(({ ipcMain }, p) => {
      ipcMain.removeHandler("dialog:pick-media");
      ipcMain.handle("dialog:pick-media", async () => [p]);
    }, f);
    await win.locator("[data-testid=media-import]").first().click();
    const key = path.basename(f).replace(/\.\w+$/, "");
    for (let i = 0; i < 20 && !(await card(key).count()); i++) await win.waitForTimeout(500);
    check(`${key} is imported`, (await card(key).count()) === 1);
  }
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async () => ({ success: true, data: {} }));
  });

  // The video's In/Out handles: about a quarter to a half.
  const v = card(videoName);
  await v.click({ position: { x: 60, y: 40 } });
  await win.waitForTimeout(400);
  const range = v.locator("[data-testid=media-range]");
  const box = await range.boundingBox();
  const dur = +(await range.getAttribute("data-out"));
  const grab = async (which, frac) => {
    const h = await v.locator(`[data-testid=media-range-${which}]`).boundingBox();
    await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * frac, h.y + h.height / 2, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(300);
  };
  await grab("out", 0.5);
  await grab("in", 0.25);
  const rin = +(await range.getAttribute("data-in"));
  const rout = +(await range.getAttribute("data-out"));
  check("the handles chose a part of the video", rout - rin > 0.3 && rout - rin < dur * 0.4, `${rin.toFixed(2)}-${rout.toFixed(2)} of ${dur.toFixed(2)}`);
  // Add the photo to the selection (⌘-click).
  await card("card-photo").click({ modifiers: ["Meta"], position: { x: 40, y: 30 } });
  await win.waitForTimeout(300);
  check("both cards are selected", (await v.getAttribute("data-selected")) === "true" && (await card("card-photo").getAttribute("data-selected")) === "true");

  // The menu: Export selected clips is the last item before Delete's group (CapCut puts it last).
  await v.hover();
  await v.locator("[title=Actions]").click();
  await win.waitForTimeout(400);
  await shot("ce1-menu");
  const items = await win.locator("[role=menuitem]").allInnerTexts();
  check("the card menu has Export selected clips", items.some((t) => /Export selected clips/.test(t)), items.join("|"));
  const clipsBefore = (await savedProject(win, udDir)).timeline.clips.length;
  await win.locator("[data-testid=media-export]").click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await win.waitForTimeout(600);
  await shot("ce2-dialog");
  check("the dialog says Selected media and names one file per card", /Selected media/.test(await T("export-timeline").innerText()) && (await T("export-name-cards").count()) === 1);
  check("it has no captions section (nothing to caption)", (await T("export-section-captions").count()) === 0);

  const setCheck = async (id, on) => {
    const b = T(`export-${id}-check`);
    if (((await b.getAttribute("data-checked")) === "true") !== on) await b.click();
    await win.waitForTimeout(100);
  };
  await setCheck("video", true);
  await setCheck("audio", false);
  await setCheck("gif", false);
  await T("export-resolution").click();
  await win.locator("[data-testid=export-resolution-option]").filter({ hasText: "480P" }).first().click();
  await win.waitForTimeout(200);
  await T("export-path").fill(dest);
  await T("export-submit").click();
  for (let i = 0; i < 600; i++) {
    const phase = await T("export-run").getAttribute("data-phase").catch(() => null);
    if (phase && phase !== "running") break;
    await win.waitForTimeout(500);
  }
  await win.waitForTimeout(500);
  await shot("ce3-done");
  const listed = await T("export-file").evaluateAll((els) => els.map((e) => e.innerText));
  const files = fs.readdirSync(dest).sort();
  check("one file per card, named after it", files.length === 2 && files.some((f) => f.startsWith(videoName) && f.endsWith(".mp4")) && files.some((f) => f === "card-photo.mp4"), files.join(","));
  check("the finished screen lists both", listed.length === 2, listed.join("|"));
  const vf = files.find((f) => f.startsWith(videoName));
  const pf = files.find((f) => f === "card-photo.mp4");
  if (vf) {
    const info = probe(path.join(dest, vf));
    const vs = stream(info, "video");
    const seconds = +info.format.duration;
    check("the video's file is as long as its range", Math.abs(seconds - (rout - rin)) < 0.35 && seconds < dur * 0.45, `${seconds.toFixed(2)}s for ${(rout - rin).toFixed(2)}s of ${dur.toFixed(2)}s`);
    check("at 480P in the card's own picture shape", Math.min(vs.width, vs.height) === 480, `${vs.width}x${vs.height}`);
    check("with its sound", !!stream(info, "audio"));
  }
  if (pf) {
    const info = probe(path.join(dest, pf));
    const vs = stream(info, "video");
    check("the photo is a still of the image duration, in its own 16:9 shape", Math.abs(+info.format.duration - 5) < 0.6 && Math.abs(vs.width / vs.height - 16 / 9) < 0.02, `${info.format.duration}s ${vs.width}x${vs.height}`);
    check("with no sound", !stream(info, "audio"));
  }
  check("the timeline got nothing", (await savedProject(win, udDir)).timeline.clips.length === clipsBefore);
  await T("export-run-done").click();
  await dialog.waitFor({ state: "hidden" });

  // A sound card on its own: just its audio, as MP3.
  await win.keyboard.press("Escape");
  await card("card-tone").hover();
  await card("card-tone").locator("[title=Actions]").click();
  await win.locator("[data-testid=media-export]").click();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await win.waitForTimeout(500);
  check("a sound card has no Video section", (await T("export-section-video").count()) === 0);
  check("its name is its own to change", (await T("export-name").inputValue()) === "card-tone", await T("export-name").inputValue().catch(() => ""));
  await setCheck("audio", true);
  await T("export-path").fill(dest);
  await T("export-submit").click();
  for (let i = 0; i < 120; i++) {
    const phase = await T("export-run").getAttribute("data-phase").catch(() => null);
    if (phase && phase !== "running") break;
    await win.waitForTimeout(500);
  }
  const after = fs.readdirSync(dest).sort();
  const tone = after.filter((f) => f.startsWith("card-tone"));
  check("the sound card wrote an audio file of its length", tone.length === 1 && Math.abs(+probe(path.join(dest, tone[0])).format.duration - 3) < 0.3, tone.join(","));
  await T("export-run-done").click();
  await dialog.waitFor({ state: "hidden" });
  fs.rmSync(dest, { recursive: true, force: true });
  return report();
};
