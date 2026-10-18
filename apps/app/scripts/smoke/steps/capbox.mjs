// With a CapCut caption's Text tab open (selcaption): uppercase it, then set its font to
// BOX_FONT (default Georgia). After each, the selection box should take the engine's new
// block about the same middle; reports the box (from Konva's transformer, CSS px) and
// whether the engine's frame changed.
import { engineFrame } from "./_preview.mjs";
const box = (win) =>
  win.evaluate(() => {
    for (const stage of window.Konva?.stages ?? []) {
      for (const tr of stage.find("Transformer")) {
        const node = tr.nodes()[0];
        if (!node || !tr.isVisible()) continue;
        const r = node.getClientRect({ skipShadow: true, skipStroke: true });
        const at = stage.container().getBoundingClientRect();
        return { cx: at.x + r.x + r.width / 2, cy: at.y + r.y + r.height / 2, w: r.width, h: r.height };
      }
    }
    return null;
  });
const fmt = (b) => (b ? `${b.w.toFixed(1)}×${b.h.toFixed(1)} at (${b.cx.toFixed(1)}, ${b.cy.toFixed(1)})` : "none");
export default async ({ win, shot }) => {
  const b0 = await box(win);
  const f0 = await engineFrame(win);
  const at = await win.evaluate(() => {
    const h = [...document.querySelectorAll("h4")].find((e) => (e.innerText || "").trim() === "Text Transform");
    const el = h?.parentElement?.querySelectorAll("button")[1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!at) throw new Error("no Text Transform buttons");
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(2000);
  const b1 = await box(win);
  const f1 = await engineFrame(win);
  await shot("b1-uppercase-box");
  const font = process.env.BOX_FONT || "Georgia";
  await win.locator("[data-testid=inspector] [role=tabpanel] [role=combobox]").first().click();
  await win.waitForTimeout(400);
  await win.keyboard.type(font);
  await win.waitForTimeout(400);
  await win.keyboard.press("Enter");
  await win.waitForTimeout(2000);
  const b2 = await box(win);
  const f2 = await engineFrame(win);
  await shot("b2-font-box");
  return [
    `box ${fmt(b0)}`,
    `uppercase → ${fmt(b1)} (frame changed ${f0.sum !== f1.sum})`,
    `${font} → ${fmt(b2)} (frame changed ${f1.sum !== f2.sum})`,
  ].join("; ");
};
