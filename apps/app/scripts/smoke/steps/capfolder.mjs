// Projects ▸ Open CapCut Project… ▸ Choose a draft folder…, with the folder picker answered by
// CAPCUT_FOLDER (a draft folder anywhere, e.g. a copy under out/ whose media paths were
// rewritten), then wait for it to open like `capcut`.
export default async ({ app, win, shot }) => {
  const folder = process.env.CAPCUT_FOLDER;
  if (!folder) throw new Error("CAPCUT_FOLDER not set");
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, folder);
  await win.getByText("Projects", { exact: true }).first().click();
  await win.waitForTimeout(500);
  await win.getByText("Open CapCut Project…", { exact: true }).click();
  await win.waitForTimeout(1500);
  const t0 = Date.now();
  await win.getByText("Choose a draft folder…", { exact: true }).click();
  for (let i = 0; i < 120; i++) {
    await win.waitForTimeout(500);
    if ((await win.getByRole("dialog").count()) === 0) break;
  }
  await win.waitForTimeout(4000);
  await shot("c2-capcut-opened");
  const toast = await win.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
  return `opened in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${toast.join(" | ").slice(0, 200)}`;
};
