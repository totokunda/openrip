// The engine draws the app's bundled fonts, and installed ones (after import timeline
// newtext): the text set to a short word, large, on a black background, then each bundled
// family (and a few installed ones) picked in Text ▸ Basic's font menu. The engine's glyphs
// (its frame with the word white minus with it black, so only the glyphs differ) are compared
// with the browser drawing the same word in the same font (canvas 2D, from the page's
// @font-face files), and with Arial, which the engine drew these fonts in before: the IoU of
// the two shapes, each scaled to its own box. A family passes when its own font matches
// closely and better than Arial. FONTS="A,B" checks some families only.
import { engineFrame, settled } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { openTab } from "./_undo.mjs";

const WORD = "Rag";
// Installed on every Mac: drawn by the engine from the system's font files.
const SYSTEM = ["Georgia", "Futura", "Helvetica Neue"];

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const text = doc.timeline.clips.find((c) => c.type === "text");
  await select(ctx, doc, text.clipId, 1.5);
  await openTab(win, "Text");

  const blur = () => win.evaluate(() => document.activeElement?.blur?.());
  const box = win.locator("[data-testid=text-box]");
  await box.fill(WORD);
  await settled(win, blur);
  const size = win.locator("[data-testid=text-font-size] input");
  await size.click({ clickCount: 3 });
  await size.fill("90");
  await settled(win, () => size.press("Enter"));
  await settled(win, () => win.getByRole("button", { name: "Align center", exact: true }).click());
  await settled(win, () => win.locator("[data-testid=text-background-on]").click());

  const pickFont = (family) =>
    settled(win, async () => {
      await win.locator("[data-testid=text-font]").click();
      await win.locator("[data-testid=font-search]").fill(family);
      await win.waitForTimeout(200);
      await win.locator(`[role=listbox] [data-font="${family}"]`).first().click();
      await win.waitForTimeout(100);
    });
  const setColor = (hex) =>
    settled(win, async () => {
      await win.locator("[data-testid=text-color]").click();
      const f = win.locator("[data-testid=color-hex]");
      await f.fill(hex);
      await f.press("Enter");
      await win.keyboard.press("Escape");
    });
  const grab = (name) =>
    win.evaluate((name) => {
      const c = document.getElementById("openrip-engine-frame");
      const g = Object.assign(document.createElement("canvas"), { width: c.width, height: c.height }).getContext("2d");
      g.drawImage(c, 0, 0);
      (window.__fc ??= {})[name] = g.getImageData(0, 0, c.width, c.height);
    }, name);

  // The bundled families, as the font menu lists them.
  await win.locator("[data-testid=text-font]").click();
  await win.getByRole("tab", { name: "Bundled", exact: true }).click();
  await win.waitForTimeout(300);
  const bundled = [...new Set(await win.locator("[role=listbox] [data-font]").evaluateAll((els) => els.map((e) => e.getAttribute("data-font"))))];
  await win.keyboard.press("Escape");
  const only = (process.env.FONTS ?? "").split(",").filter(Boolean);
  const families = [...bundled.map((f) => [f, 400]), ["Poppins", 700], ...SYSTEM.map((f) => [f, 400])].filter(([f]) => !only.length || only.includes(f));
  check(`the font menu lists the bundled families (${bundled.join(", ")})`, bundled.length >= 10);

  // IoU of the engine's glyph mask (white − black frames) and the browser's word in `font`.
  const compare = (family, weight) =>
    win.evaluate(
      async ({ family, weight, word }) => {
        const GW = 192, GH = 96;
        // A mask on a grid, from its box in an image.
        const fit = (on, w, h) => {
          let [x0, y0, x1, y1] = [w, h, -1, -1];
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
          if (x1 < 0) return null;
          const grid = new Uint8Array(GW * GH);
          for (let gy = 0; gy < GH; gy++)
            for (let gx = 0; gx < GW; gx++) {
              const x = Math.floor(x0 + ((gx + 0.5) * (x1 - x0 + 1)) / GW);
              const y = Math.floor(y0 + ((gy + 0.5) * (y1 - y0 + 1)) / GH);
              grid[gy * GW + gx] = on(x, y) ? 1 : 0;
            }
          return { grid, w: x1 - x0 + 1, h: y1 - y0 + 1 };
        };
        const [white, black] = [window.__fc.white, window.__fc.black];
        const lum = (d, i) => d[i] + d[i + 1] + d[i + 2];
        const engine = fit((x, y) => lum(white.data, (y * white.width + x) * 4) - lum(black.data, (y * white.width + x) * 4) > 3 * 128, white.width, white.height);
        const browser = async (fam, wt) => {
          const font = `${wt} 200px "${fam}"`;
          await document.fonts.load(font, word);
          const c = Object.assign(document.createElement("canvas"), { width: 900, height: 400 });
          const g = c.getContext("2d");
          g.fillStyle = "#000";
          g.fillRect(0, 0, 900, 400);
          g.fillStyle = "#fff";
          g.font = font;
          g.fillText(word, 40, 280);
          const d = g.getImageData(0, 0, 900, 400).data;
          return fit((x, y) => d[(y * 900 + x) * 4] > 127, 900, 400);
        };
        const iou = (a, b) => {
          let i = 0, u = 0;
          for (let k = 0; k < a.grid.length; k++) {
            i += a.grid[k] & b.grid[k];
            u += a.grid[k] | b.grid[k];
          }
          return u ? i / u : 0;
        };
        const own = await browser(family, weight);
        const arial = await browser("Arial", weight);
        if (!engine || !own || !arial) return null;
        return { own: iou(engine, own), arial: iou(engine, arial), aspect: [engine.w / engine.h, own.w / own.h], em: engine.h };
      },
      { family, weight, word: WORD },
    );

  let color = "FFFFFF";
  let bold = false;
  for (const [family, weight] of families) {
    if ((weight >= 700) !== bold) {
      await settled(win, () => win.locator("[data-testid=text-bold]").click());
      bold = weight >= 700;
    }
    await pickFont(family);
    // Both colours in this font, from whichever it's in now.
    await grab(color === "FFFFFF" ? "white" : "black");
    color = color === "FFFFFF" ? "000000" : "FFFFFF";
    await setColor(color);
    await grab(color === "FFFFFF" ? "white" : "black");
    if (color === "FFFFFF") await shot(`fc-${family.replace(/\s+/g, "-")}-${weight}`);
    const r = await compare(family, weight);
    if (!r) {
      check(`${family} ${weight}: the engine drew it`, false);
      continue;
    }
    check(
      `${family} ${weight}: the engine's glyphs match the browser's (IoU ${r.own.toFixed(3)}, against Arial ${r.arial.toFixed(3)}; width/height ${r.aspect.map((a) => a.toFixed(2)).join(" vs ")}; ${r.em} px tall)`,
      r.own >= 0.8 && r.own > r.arial + 0.04,
    );
  }
  return report();
};
