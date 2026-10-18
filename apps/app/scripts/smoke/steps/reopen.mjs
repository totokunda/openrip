// Reopen the project from the home screen: home, a new project, home again, then this one's
// card, read again from its saved file. REOPEN names it (after a restart, the app opens the
// last).
import { goHome } from "./_preview.mjs";
export default async ({ win, shot }) => {
  const name = process.env.REOPEN || (await win.locator("[data-testid=project-name]").inputValue());
  await goHome(win);
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(3000);
  await goHome(win);
  await win.locator("[data-testid=project-card]").filter({ has: win.getByText(name, { exact: true }) }).first().locator("button[title^='Open ']").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(6000);
  await shot("r1-reopened");
  const now = await win.locator("[data-testid=project-name]").inputValue();
  if (now !== name) throw new Error(`opened "${now}", not "${name}"`);
  return `reopened "${name}"`;
};
