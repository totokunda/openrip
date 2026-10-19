// The cover editor (after `import timeline`; IMG_9079 with CLIP_NAME=IMG_9079, engine on):
// the timeline's Cover tile opens "Select a cover" (the engine's picture at the scrubber, a
// filmstrip of the video); a frame picked, Edit cover opens "Cover design" where a title is
// added, typed, coloured and dragged, Cancel asks "Exit editing?"; Save writes the cover: the
// file, the choice in the project, the home card's picture, and the automatic cover leaving it
// alone; the choice survives a restart; Local takes an image; "Use the first frame" goes back.
// Shots: c1-select ↔ 31-dialogs/027-cover-frame-selector, c2-design ↔ 029-cover-design-text,
// c3-selected ↔ 033-cover-selected-image, c4-exit ↔ 035-cover-exit-confirmation, c5-home ↔ home card,
// c6-local ↔ 027's Local tab.
import path from "node:path";
import crypto from "node:crypto";
import { goHome, openEditor } from "./_preview.mjs";
import { checks, rowOf } from "./_anim.mjs";
import { rulerMap, seek } from "./_preview.mjs";
import { photoFixture } from "./_settings.mjs";

export default async (ctx) => {
  const { win, shot, fs, udDir } = ctx;
  const { check, report } = checks();
  const dir = path.join(udDir, "projects-json");
  const coverFile = path.join(dir, "covers", "project-1.jpg");
  const hashFile = (f) => crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex");
  const doc = () => JSON.parse(fs.readFileSync(path.join(dir, "project-1.json"), "utf8"));
  const waitSaved = async (pred, ms = 8000) => {
    for (let t = 0; t < ms; t += 250) {
      if (pred(doc())) return true;
      await win.waitForTimeout(250);
    }
    return false;
  };
  const previewTime = async () => +(await win.locator("[data-testid=cover-preview]").getAttribute("data-time"));
  const scrubTo = async (frac) => {
    const r = await win.locator("[data-testid=cover-filmstrip]").boundingBox();
    await win.mouse.click(r.x + r.width * frac, r.y + r.height / 2);
  };
  const settledPreview = async () => {
    const want = +(await win.locator("[data-testid=cover-filmstrip]").getAttribute("data-time"));
    for (let i = 0; i < 40; i++) {
      if (Math.abs((await previewTime()) - want) < 2) break;
      await win.waitForTimeout(250);
    }
    await win.waitForTimeout(300);
  };
  // The picture's pixels, summed coarsely, so two frames can be told apart.
  const pictureHash = (sel) =>
    win.evaluate(async (sel) => {
      const img = document.querySelector(sel);
      if (!img?.complete || !img.naturalWidth) return null;
      const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0, 32, 32);
      return [...g.getImageData(0, 0, 32, 32).data].filter((_, i) => i % 4 < 3).join(",");
    }, sel);
  const diff = (a, b) => {
    const x = a.split(",").map(Number);
    const y = b.split(",").map(Number);
    return x.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / x.length;
  };
  const coverMeans = (url) =>
    win.evaluate(async (url) => {
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return { w: bmp.width, h: bmp.height, mean: [r, gg, b].map((v) => v / 256) };
    }, url);

  // Home and back: the automatic cover (the first frame) is written on the way.
  await goHome(win);
  await win.waitForTimeout(1000);
  await openEditor(win);
  await win.waitForTimeout(2500);
  const before = hashFile(coverFile);
  check("the project has its automatic cover", fs.existsSync(coverFile));
  check("no chosen cover yet", !doc().settings.cover);

  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 3);
  const row = await rowOf(ctx, "video");
  await win.mouse.click(ctx.map.x(0) - 25, row);
  await win.waitForSelector("[data-testid=cover-dialog]", { timeout: 10000 });
  check("the Cover tile opens Select a cover", true);
  await settledPreview();
  await win.waitForTimeout(1500);
  const t0 = await previewTime();
  check("the scrubber starts at the playhead (3 s)", Math.abs(t0 / 1e6 - 3) < 0.05, `${t0 / 1e6} s`);
  const tilesLoaded = await win.locator("[data-testid=cover-filmstrip] img").count();
  check("the filmstrip shows the video's frames", tilesLoaded >= 10, `${tilesLoaded} tiles`);
  const p0 = await pictureHash("[data-testid=cover-preview] img");
  check("the preview shows the engine's frame", !!p0);
  await shot("c1-select");

  await scrubTo(0.85);
  await settledPreview();
  const t1 = await previewTime();
  const dur = +(await win.locator("[data-testid=cover-filmstrip]").getAttribute("data-duration"));
  check("the scrubber moved to 85 %", Math.abs(t1 / dur - 0.85) < 0.03, `${(t1 / 1e6).toFixed(2)} s of ${(dur / 1e6).toFixed(2)}`);
  const p1 = await pictureHash("[data-testid=cover-preview] img");
  check("and the picture is another frame", !!p1 && !!p0 && diff(p0, p1) > 2, `${p0 && p1 ? diff(p0, p1).toFixed(1) : "?"}`);

  // The Local tab and back.
  await win.locator("[data-testid=cover-tab-local]").click();
  await win.waitForTimeout(300);
  check("Local asks for an image, Edit cover off", (await win.locator("[data-testid=cover-choose]").count()) === 1 && (await win.locator("[data-testid=cover-edit]").isDisabled()));
  await shot("c6-local-empty");
  await win.locator("[data-testid=cover-tab-video]").click();
  await settledPreview();

  await win.locator("[data-testid=cover-edit]").click();
  await win.waitForSelector("[data-testid=cover-design]");
  await win.locator("[data-testid=cover-add-title]").click();
  await win.waitForTimeout(300);
  check("Add a title puts a text on the page, selected", (await win.locator("[data-testid=cover-text]").count()) === 1 && (await win.locator("[data-testid=cover-text][data-selected=true]").count()) === 1);
  await win.locator("[data-testid=cover-text-input]").fill("MY COVER");
  await win.locator("[data-testid=cover-text-color][data-color='#ffd84d']").click();
  const box0 = await win.locator("[data-testid=cover-text]").boundingBox();
  await win.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
  await win.mouse.down();
  await win.mouse.move(box0.x + box0.width / 2 + 30, box0.y + box0.height / 2 - 120, { steps: 6 });
  await win.mouse.up();
  const box1 = await win.locator("[data-testid=cover-text]").boundingBox();
  check("the text can be dragged", box1.y < box0.y - 90 && box1.x > box0.x + 20, `${Math.round(box1.x - box0.x)}, ${Math.round(box1.y - box0.y)}`);
  await win.locator("[data-testid=cover-add-subtitle]").click();
  await win.locator("[data-testid=cover-text-input]").fill("part one");
  await win.waitForTimeout(300);
  check("a second text for the subtitle", (await win.locator("[data-testid=cover-text]").count()) === 2);
  await shot("c2-design");
  await win.mouse.click(box1.x + box1.width / 2, box1.y + box1.height / 2);
  await win.locator("[data-testid=cover-text-delete]").click();
  check("Delete text removes it", (await win.locator("[data-testid=cover-text]").count()) === 1);
  await shot("c3-selected");

  // Cancel asks first; Cancel keeps editing; Exit leaves with nothing saved.
  await win.locator("[data-testid=cover-design-cancel]").click();
  await win.waitForSelector("[data-testid=cover-exit-confirm]");
  await shot("c4-exit");
  check("Exit editing? says changes won't be saved", (await win.getByText("Your changes won’t be saved.").count()) === 1);
  await win.locator("[data-testid=cover-exit-cancel]").click();
  check("Cancel there keeps the design", (await win.locator("[data-testid=cover-design]").count()) === 1 && (await win.locator("[data-testid=cover-text]").count()) === 1);
  await win.keyboard.press("Escape");
  await win.waitForSelector("[data-testid=cover-exit-confirm]");
  await win.locator("[data-testid=cover-exit]").click();
  await win.waitForTimeout(500);
  check("Exit closes it, nothing saved", (await win.locator("[data-testid=cover-design]").count()) === 0 && hashFile(coverFile) === before && !doc().settings.cover);

  // Again, and save.
  await win.mouse.click(ctx.map.x(0) - 25, row);
  await win.waitForSelector("[data-testid=cover-dialog]");
  await win.waitForTimeout(1500);
  await scrubTo(0.85);
  await settledPreview();
  const tSave = await previewTime();
  await win.locator("[data-testid=cover-edit]").click();
  await win.locator("[data-testid=cover-add-title]").click();
  await win.locator("[data-testid=cover-text-input]").fill("MY COVER");
  await win.locator("[data-testid=cover-text-color][data-color='#ffd84d']").click();
  await win.locator("[data-testid=cover-save]").click();
  await win.waitForSelector("[data-testid=cover-design]", { state: "detached", timeout: 15000 });
  check("Save closes the editor", true);
  const saved = await waitSaved((d) => !!d.settings.cover);
  check("the project keeps the choice (frame, time, text)", saved && doc().settings.cover.source.kind === "frame" && Math.abs(doc().settings.cover.source.timeUs - tSave) < 2 && doc().settings.cover.texts.length === 1 && doc().settings.cover.texts[0].text === "MY COVER", JSON.stringify(doc().settings.cover));
  const after = hashFile(coverFile);
  check("the cover file changed", after !== before);
  const url = `app://user-data${encodeURI(coverFile)}?v=${Date.now()}`;
  const m = await coverMeans(url);
  const proj = doc().settings.aspectRatio;
  check("720 px tall, the project's shape", m.h === 720 && Math.abs(m.w / m.h - proj.width / proj.height) < 0.01, `${m.w}x${m.h}`);
  // The yellow title is in it: more yellow-ish pixels than the automatic cover had.
  const yellow = await win.evaluate(async (url) => {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 170 && d[i + 2] < 120) n++;
    return n;
  }, url);
  check("the yellow title is drawn into it", yellow > 400, `${yellow} px`);

  // The home card and the automatic cover.
  await goHome(win);
  await win.waitForTimeout(1500);
  const card = win.locator("[data-testid=project-card][data-project-id='1'] img");
  const src = await card.getAttribute("src");
  const served = await win.evaluate(async (src) => {
    const b = new Uint8Array(await (await fetch(src)).arrayBuffer());
    let h = 0;
    for (let i = 0; i < b.length; i += 97) h = (h * 31 + b[i]) | 0;
    return { n: b.length, h };
  }, src);
  const file = fs.readFileSync(coverFile);
  let h = 0;
  for (let i = 0; i < file.length; i += 97) h = (h * 31 + file[i]) | 0;
  check("the home card shows the new cover", served.n === file.length && served.h === h);
  await shot("c5-home");
  await openEditor(win);
  await win.waitForTimeout(2000);
  await win.keyboard.press("ArrowRight");
  await win.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
  await win.waitForTimeout(2500);
  await goHome(win);
  await win.waitForTimeout(1500);
  check("an edit and going home leave the chosen cover as it is", hashFile(coverFile) === after);
  await openEditor(win);
  await win.waitForTimeout(1500);

  // It survives a restart.
  const next = await ctx.relaunch();
  const w = next.win;
  await openEditor(w);
  await w.waitForTimeout(4000);
  ctx.map = await rulerMap(w);
  await w.mouse.click(ctx.map.x(0) - 25, row);
  await w.waitForSelector("[data-testid=cover-dialog]");
  await w.waitForTimeout(1500);
  const tBack = +(await w.locator("[data-testid=cover-filmstrip]").getAttribute("data-time"));
  check("after a restart the scrubber is where it was left", Math.abs(tBack - tSave) < 2, `${tBack}`);
  await w.locator("[data-testid=cover-edit]").click();
  await w.waitForSelector("[data-testid=cover-design]");
  check("and its text is there to edit", (await w.locator("[data-testid=cover-text]").count()) === 1 && (await w.locator("[data-testid=cover-text]").innerText()) === "MY COVER");
  await w.locator("[data-testid=cover-design-cancel]").click();
  await w.locator("[data-testid=cover-exit]").click();

  // A local image.
  const photo = photoFixture(ctx);
  await next.app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, photo);
  await w.mouse.click(ctx.map.x(0) - 25, row);
  await w.waitForSelector("[data-testid=cover-dialog]");
  await w.locator("[data-testid=cover-tab-local]").click();
  await w.locator("[data-testid=cover-choose]").click();
  await w.waitForTimeout(1200);
  await w.screenshot({ path: `${ctx.outDir}/c6-local.png` });
  await w.locator("[data-testid=cover-edit]").click();
  await w.waitForSelector("[data-testid=cover-design]");
  await w.locator("[data-testid=cover-save]").click();
  await w.waitForSelector("[data-testid=cover-design]", { state: "detached", timeout: 15000 });
  await w.waitForTimeout(2500);
  const d2 = doc().settings.cover;
  check("the local image is the saved choice", d2?.source.kind === "image" && d2.source.path === photo, JSON.stringify(d2?.source));
  const mm = await (async () => {
    const f = (u) => w.evaluate(async (u) => {
      const bmp = await createImageBitmap(await (await fetch(u)).blob());
      const c = document.createElement("canvas");
      c.width = 24; c.height = 24;
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      const out = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) out[k] += d[i + k] / 576;
      return out;
    }, u);
    return { cover: await f(`app://user-data${encodeURI(coverFile)}?v=${Date.now()}`), photo: await f(`app://user-data${encodeURI(photo)}`) };
  })();
  const dist = Math.hypot(...mm.cover.map((v, i) => v - mm.photo[i]));
  check("the cover is the photo (mean colour close to it)", dist < 45, `${dist.toFixed(1)}`);
  check("not the video's frame any more", hashFile(coverFile) !== after);

  // Back to the first frame.
  await w.mouse.click(ctx.map.x(0) - 25, row);
  await w.waitForSelector("[data-testid=cover-dialog]");
  await w.locator("[data-testid=cover-reset]").click();
  await w.waitForTimeout(1500);
  check("Use the first frame: the choice is gone from the project", await waitSaved((d) => !d.settings.cover));
  return report();
};
