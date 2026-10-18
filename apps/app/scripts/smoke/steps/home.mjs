// The home screen: back to it by the top bar's Home button (when in the editor), a shot of
// it, and the open project's card (with its cover, when the engine drew a frame) checked;
// then into the editor again by that card.
import { goHome, openEditor } from "./_preview.mjs";
import { checks } from "./_anim.mjs";

export default async ({ win, shot }) => {
  const { check, report } = checks();
  if (await win.locator("[data-testid=editor]").count()) await goHome(win);
  await win.waitForTimeout(1500);
  await shot("h1-home");
  const cards = win.locator("[data-testid=project-card]");
  const active = win.locator("[data-testid=project-card][data-active=true]");
  check("projects listed, the open one marked", (await cards.count()) > 0 && (await active.count()) === 1, `${await cards.count()} cards`);
  const n = await cards.count();
  const cover = await active.locator("img").count();
  const presets = await win.locator("[data-testid^=new-project-]").count();
  check("new-project sizes offered", presets >= 4, `${presets} sizes`);
  await openEditor(win);
  return `${n} projects; open one has a cover: ${cover > 0}\n  ` + report();
};
