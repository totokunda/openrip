// The media for the new timeline's thumbnails and waveforms (after `import timeline` on PULSE.mp4:
// 14 s of a changing picture with a pulsing, sweeping sound): a photo and a tone imported and
// added to the timeline through the media cards' "Add to the timeline" (the old timeline's drop
// is what `import` and `timeline` use). Run before `tl2on`.
import path from "node:path";

const importFile = async (ctx, file) => {
  const { app, win } = ctx;
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, file);
  await win.locator("[data-testid=media-import]").first().click();
  const name = path.basename(file);
  for (let i = 0; i < 40 && !(await win.locator(`[data-testid=media-card][data-name^="${name.replace(/\.[^.]+$/, "")}"]`).count()); i++) await win.waitForTimeout(500);
  await win.waitForTimeout(2500);
  return name.replace(/\.[^.]+$/, "");
};

const add = async (ctx, stem) => {
  const { win } = ctx;
  const card = win.locator(`[data-testid=media-card][data-name^="${stem}"]`).first();
  await card.hover();
  await win.waitForTimeout(300);
  await card.locator("[data-testid=media-add]").click({ force: true });
  await win.waitForTimeout(2500);
};

export default async (ctx) => {
  const dir = process.env.MEDIA_DIR || path.dirname(ctx.clipPath);
  const photo = await importFile(ctx, path.join(dir, "PHOTO.png"));
  await add(ctx, photo);
  const tone = await importFile(ctx, path.join(dir, "TONE.wav"));
  await add(ctx, tone);
  await ctx.shot("tl2media-prep");
  return `${photo}, ${tone} added`;
};
