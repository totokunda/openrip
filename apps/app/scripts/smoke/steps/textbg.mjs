// Text ▸ Basic's Background geometry and Curve (after `import timeline newtext`; the playhead at
// 1.5 s on the text; OPENRIP_ENGINE_MUTE=1). Each change is made through the inspector and
// checked in the project as saved and in the engine's frame (preview = export: the engine draws
// both):
// - Background on gives CapCut's 14 % padding; the style tiles (Rectangle, Rounded, Pill) set the
//   corner radius; Width and Height grow the red box on the frame; X and Y offset move it
//   without moving the text; one undo step each;
// - Curve on bends the text (72°, its ends dropping below its middle); a negative strength sags
//   it; both are undone as one step.
// Leaves the clip and the engine's frame on ctx.textBg for `textbgcheck`, after `reopen`.
// Shots: `tb1-geometry` ↔ `21-inspector-text/014`, `tb2-curve` ↔ `017`.
import { seek, settled } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { openTab, undoCase } from "./_undo.mjs";

/** Where the engine's frame has pixels `test` accepts: count, bounding box and centre. */
export const inkBox = (win, test) =>
  win.evaluate((test) => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    const pick = new Function("r", "g", "b", `return ${test};`);
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sx = 0, sy = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (!pick(d[i], d[i + 1], d[i + 2])) continue;
      const x = p % t.width, y = (p / t.width) | 0;
      n++; sx += x; sy += y;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { n, x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: n ? sx / n : 0, cy: n ? sy / n : 0 };
  }, test);

/** The mean row of the ink (pixels `test` accepts) in its outer tenths of columns against its middle tenth: positive when its ends sit lower than its middle (an arch). */
export const bend = (win, test) =>
  win.evaluate((test) => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    const pick = new Function("r", "g", "b", `return ${test};`);
    const px = [];
    let x0 = 1e9, x1 = -1;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) if (pick(d[i], d[i + 1], d[i + 2])) { const x = p % t.width; px.push([x, (p / t.width) | 0]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    const mean = (f) => { const s = px.filter(([x]) => f((x - x0) / Math.max(1, x1 - x0))); return s.reduce((a, [, y]) => a + y, 0) / Math.max(1, s.length); };
    return mean((u) => u < 0.1 || u > 0.9) - mean((u) => u > 0.45 && u < 0.55);
  }, test);

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const first = (await savedProject(win, udDir)).timeline.clips.find((c) => c.type === "text");
  const id = first.clipId;
  const saved = async () => {
    await win.waitForTimeout(1500);
    return (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === id);
  };
  await seek(win, ctx.map, 1.5);
  await select(ctx, await savedProject(win, udDir), id, 1.5);
  await openTab(win, "Text");
  const q = (sel) => win.locator(sel).first();
  const slider = (section, label) => win.locator(`[data-testid=${section}] label`, { hasText: new RegExp(`^${label}$`) }).first().locator("xpath=..").locator("input").first();
  const type = async (input, value) => {
    await input.scrollIntoViewIfNeeded();
    await input.click({ clickCount: 3 });
    await input.fill(String(value));
    await input.press("Enter");
  };
  const color = async (well, hex) => {
    await q(`[data-testid=${well}]`).click();
    const f = q("[data-testid=color-hex]");
    await f.fill(hex);
    await f.press("Enter");
    await win.keyboard.press("Escape");
  };
  const RED = "r > 200 && g < 60 && b < 60";
  const WHITE = "r > 235 && g > 235 && b > 235";
  const edit = (name, fn) => undoCase(ctx, check, name, () => settled(win, fn));

  // Background: on, red.
  await edit("Background on", async () => q("[data-testid=text-background-on]").click());
  await settled(win, () => color("text-background-color", "ff0000"));
  let c = await saved();
  check("Background on gives 14 % Height and Width, centred", c.backgroundEnabled && c.backgroundWidth === 14 && c.backgroundHeight === 14, JSON.stringify([c.backgroundWidth, c.backgroundHeight]));
  const base = await inkBox(win, RED);
  check(`the engine draws a red box (${base.n} px, ${base.w}×${base.h})`, base.n > 500);
  const textBase = await inkBox(win, WHITE);

  // The style tiles.
  await edit("the Rounded tile", async () => q("[data-testid=text-background-style-rounded]").click());
  check("Rounded sets the corner radius", (await saved()).backgroundCornerRadius === 8);
  await edit("the Pill tile", async () => q("[data-testid=text-background-style-pill]").click());
  check("Pill sets the largest radius", (await saved()).backgroundCornerRadius === 50);
  await settled(win, () => q("[data-testid=text-background-style-square]").click());
  check("Rectangle takes it back to square corners", (await saved()).backgroundCornerRadius === 0);

  // Width and Height.
  await edit("Width 40", () => type(slider("text-background", "Width"), 40));
  const wide = await inkBox(win, RED);
  check(`a wider Width widens the box (${base.w} → ${wide.w} px), its height the same`, wide.w > base.w + 10 && Math.abs(wide.h - base.h) <= 2);
  await edit("Height 50", () => type(slider("text-background", "Height"), 50));
  const tall = await inkBox(win, RED);
  check(`a larger Height heightens it (${wide.h} → ${tall.h} px)`, tall.h > wide.h + 10 && Math.abs(tall.w - wide.w) <= 2);
  c = await saved();
  check("both are in the saved clip", c.backgroundWidth === 40 && c.backgroundHeight === 50, JSON.stringify([c.backgroundWidth, c.backgroundHeight]));

  // Offsets: the box moves, the text doesn't.
  await shot("tb1-geometry");
  await edit("X-offset 80", () => type(slider("text-background", "X-offset"), 80));
  const right = await inkBox(win, RED);
  const textRight = await inkBox(win, WHITE);
  check(`X-offset 80 moves the box right (${tall.cx.toFixed(0)} → ${right.cx.toFixed(0)}), not the text`, right.cx > tall.cx + 5 && Math.abs(textRight.cx - textBase.cx) <= 2);
  await edit("Y-offset 20", () => type(slider("text-background", "Y-offset"), 20));
  const up = await inkBox(win, RED);
  check(`Y-offset 20 moves it up (${right.cy.toFixed(0)} → ${up.cy.toFixed(0)})`, up.cy < right.cy - 5);
  c = await saved();
  check("the offsets are in the saved clip", c.backgroundOffsetX === 80 && c.backgroundOffsetY === 20);
  await type(slider("text-background", "X-offset"), 50);
  await type(slider("text-background", "Y-offset"), 50);
  await settled(win, () => type(slider("text-background", "Width"), 14));
  await settled(win, () => type(slider("text-background", "Height"), 14));

  // Curve.
  const straight = await inkBox(win, WHITE);
  await edit("Curve on", async () => q("[data-testid=text-curve-on]").click());
  c = await saved();
  check("Curve on starts at 72°", c.textCurve === 72, `${c.textCurve}`);
  const arch = await inkBox(win, WHITE);
  const archBend = await bend(win, WHITE);
  check(`the text arches (its height ${straight.h} → ${arch.h} px, its ends ${archBend.toFixed(1)} px below its middle)`, arch.h > straight.h + 4 && archBend > 3);
  await shot("tb2-curve");
  await edit("Curve strength -120", () => type(slider("text-curve", "Strength"), -120));
  const sag = await inkBox(win, WHITE);
  const sagBend = await bend(win, WHITE);
  c = await saved();
  check(`a negative strength sags it the other way (its ends ${sagBend.toFixed(1)} px against its middle)`, c.textCurve === -120 && sag.h > straight.h + 4 && sagBend < -3 && archBend > 3, `arch ${archBend}`);
  await type(slider("text-curve", "Strength"), 72);
  await win.waitForTimeout(500);
  await settled(win, () => q("[data-testid=text-background-style-rounded]").click());
  const clip = await saved();
  ctx.textBg = { id, clip, frame: (await inkBox(win, "true")).n, curved: await inkBox(win, WHITE) };
  return report();
};
