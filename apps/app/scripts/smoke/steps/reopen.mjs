// Reopen the project through the Projects menu: a new project, then back to this one by name,
// read again from its saved file. REOPEN names it (after a restart, the app opens the last).
export default async ({ win, shot }) => {
  const name = process.env.REOPEN || (await win.locator('input[placeholder="Project 1"]').inputValue());
  const menu = async () => {
    await win.getByText("Projects", { exact: true }).first().click();
    await win.waitForTimeout(600);
  };
  await menu();
  await win.getByText("New Project", { exact: true }).click();
  await win.waitForTimeout(3000);
  await menu();
  await win.getByRole("menuitem").filter({ hasText: name }).first().click();
  await win.waitForTimeout(6000);
  await shot("r1-reopened");
  const now = await win.locator('input[placeholder="Project 1"]').inputValue();
  if (now !== name) throw new Error(`opened "${now}", not "${name}"`);
  return `reopened "${name}"`;
};
