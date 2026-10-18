// With a caption's Text tab open (selcaption): uppercase it, then make its stroke red. Checks the
// engine's frame changes after each edit and red pixels appear.
import { engineFrame } from "./_preview.mjs";
const RED = "r > 170 && g < 90 && b < 90";
export default async ({ win, shot }) => {
  const before = await engineFrame(win, RED);
  const at = await win.evaluate(() => {
    const h = [...document.querySelectorAll("[data-testid=inspector] h4")].find((e) => (e.innerText || "").trim() === "Text Transform");
    const el = h?.parentElement?.querySelectorAll("button")[1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!at) throw new Error("no Text Transform buttons");
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(1500);
  const upper = await engineFrame(win, RED);
  await shot("t2-uppercase");
  // Stroke ▸ Color: the second hex field in the inspector.
  const fields = win.locator("[data-testid=inspector] [role=tabpanel] input");
  const hexes = [];
  for (let i = 0; i < (await fields.count()); i++) {
    const v = await fields.nth(i).inputValue().catch(() => "");
    if (/^#?[0-9a-f]{6}$/i.test(v)) hexes.push(i);
  }
  if (hexes.length < 2) throw new Error(`hex fields: ${hexes.length}`);
  const stroke = fields.nth(hexes[1]);
  await stroke.scrollIntoViewIfNeeded();
  await stroke.click({ clickCount: 3 });
  await stroke.fill("#ff0000");
  await stroke.press("Enter");
  await win.waitForTimeout(1500);
  const red = await engineFrame(win, RED);
  await shot("t3-red-stroke");
  return `red pixels ${before.count} → ${upper.count} → ${red.count}; frame changed on uppercase ${before.sum !== upper.sum}, on stroke ${upper.sum !== red.sum}`;
};
