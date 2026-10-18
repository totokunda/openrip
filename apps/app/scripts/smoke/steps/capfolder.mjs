// Home ▸ Open a CapCut project ▸ Choose a draft folder…, with the folder picker answered by
// CAPCUT_FOLDER (a draft folder anywhere, e.g. a copy under out/ whose media paths were
// rewritten), then wait for it to open like `capcut`.
import { openCapCutDialog, waitOpened } from "./capcut.mjs";

export default async ({ app, win, shot }) => {
  const folder = process.env.CAPCUT_FOLDER;
  if (!folder) throw new Error("CAPCUT_FOLDER not set");
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, folder);
  await openCapCutDialog(win);
  const t0 = Date.now();
  await win.getByText("Choose a draft folder…", { exact: true }).click();
  await waitOpened(win);
  await shot("c2-capcut-opened");
  const toast = await win.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
  return `opened in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${toast.join(" | ").slice(0, 200)}`;
};
