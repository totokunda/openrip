// Projects ▸ Open CapCut Project…, pick the draft whose card text contains CAPCUT_DRAFT, wait
// for it to open. "opened in" includes a fixed 4 s wait.
export default async ({ win, shot }) => {
  const want = process.env.CAPCUT_DRAFT || "";
  await win.getByText("Projects", { exact: true }).first().click();
  await win.waitForTimeout(500);
  await win.getByText("Open CapCut Project…", { exact: true }).click();
  await win.waitForTimeout(1500);
  await shot("c1-capcut-dialog");
  const cards = win.getByRole("dialog").locator("button[title]");
  const n = await cards.count();
  // The card named exactly that, else the first whose text contains it.
  let picked = null;
  for (let i = 0; i < n; i++) {
    const t = await cards.nth(i).innerText();
    if (t.split("\n")[0].trim() === want) { picked = cards.nth(i); break; }
    if (!picked && t.includes(want)) picked = cards.nth(i);
  }
  if (!picked) throw new Error(`no draft matching "${want}" among ${n}`);
  const t0 = Date.now();
  await picked.click();
  for (let i = 0; i < 120; i++) {
    await win.waitForTimeout(500);
    if ((await win.getByRole("dialog").count()) === 0) break;
  }
  await win.waitForTimeout(4000);
  await shot("c2-capcut-opened");
  const toast = await win.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
  return `opened in ${((Date.now() - t0) / 1000).toFixed(1)} s; drafts listed ${n}; ${toast.join(" | ").slice(0, 200)}`;
};
