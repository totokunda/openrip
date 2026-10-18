// Home ▸ Open a CapCut project, pick the draft whose card text contains CAPCUT_DRAFT, wait
// for it to open in the editor. "opened in" includes a fixed 4 s wait.
import { goHome } from "./_preview.mjs";

// The CapCut dialog, from the home screen (going there first from the editor).
export const openCapCutDialog = async (win) => {
  if (await win.locator("[data-testid=editor]").count()) await goHome(win);
  await win.locator("[data-testid=home-open-capcut]").click();
  await win.waitForTimeout(1500);
};

// Until the dialog has closed and the editor shows the opened project.
export const waitOpened = async (win) => {
  for (let i = 0; i < 120; i++) {
    await win.waitForTimeout(500);
    if ((await win.getByRole("dialog").count()) === 0) break;
  }
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(4000);
};

export default async ({ win, shot }) => {
  const want = process.env.CAPCUT_DRAFT || "";
  await openCapCutDialog(win);
  await shot("c1-capcut-dialog");
  const cards = win.locator("[data-testid=capcut-draft]");
  const n = await cards.count();
  // The card named exactly that, else the first whose name contains it (cards show long
  // names cut in the middle, so this reads the full name from data-name).
  let picked = null;
  for (let i = 0; i < n; i++) {
    const t = (await cards.nth(i).getAttribute("data-name")) ?? "";
    if (t === want) { picked = cards.nth(i); break; }
    if (!picked && t.includes(want)) picked = cards.nth(i);
  }
  if (!picked) throw new Error(`no draft matching "${want}" among ${n}`);
  const t0 = Date.now();
  await picked.click();
  await waitOpened(win);
  await shot("c2-capcut-opened");
  const toast = await win.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
  return `opened in ${((Date.now() - t0) / 1000).toFixed(1)} s; drafts listed ${n}; ${toast.join(" | ").slice(0, 200)}`;
};
