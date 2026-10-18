// Upload Media with the file picker stubbed to return the clip.
export default async ({ app, win, shot, clipPath }) => {
  await app.evaluate(({ ipcMain }, p) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [p]);
  }, clipPath);
  const t0 = Date.now();
  await win.locator("[data-testid=media-import]").click();
  let seen = "no conversion";
  for (let i = 0; i < 90; i++) {
    await win.waitForTimeout(1000);
    const body = await win.locator("body").innerText();
    if (/Converting/.test(body)) seen = "conversion toast";
    if (!/Converting|Importing/.test(body) && i > 3) break;
  }
  await win.waitForTimeout(3000);
  await shot("1-imported");
  // Mostly the fixed waits above, not import time.
  return `${seen}; ${(Date.now() - t0) / 1000}s`;
};
