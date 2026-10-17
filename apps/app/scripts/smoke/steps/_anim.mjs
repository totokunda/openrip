// Animation tab helpers: its rows' selects, the Duration slider and the note under a section;
// the project as saved; and a log of checks.
import fs from "node:fs";
import path from "node:path";
import { now, settled, tab, timelineRect } from "./_preview.mjs";

// The select in the panel row labelled `label` ("Animation", "Words", "Transition"): its
// shown value, or null when there's no such row.
export const selected = (win, label) => win.evaluate((label) => {
  const h = [...document.querySelectorAll("[role=tabpanel] h4")].find((e) => e.innerText.trim() === label);
  return h?.parentElement?.querySelector("[role=combobox]")?.innerText.trim() ?? null;
}, label);

const openSelect = async (win, label) => {
  const at = await win.evaluate((label) => {
    const h = [...document.querySelectorAll("[role=tabpanel] h4")].find((e) => e.innerText.trim() === label);
    const r = h?.parentElement?.querySelector("[role=combobox]")?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, label);
  if (!at) throw new Error(`no ${label} select`);
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(400);
};

// What the row's select offers.
export const options = async (win, label) => {
  await openSelect(win, label);
  const names = await win.getByRole("option").allInnerTexts();
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
  return names.map((n) => n.trim());
};

// Pick `option` in the row's select and wait for the engine's picture.
export const choose = async (win, label, option) => {
  await openSelect(win, label);
  await settled(win, () => win.getByRole("option", { name: option, exact: true }).click());
};

// The Duration slider's value in seconds, its bounds, or null when it isn't shown.
export const duration = (win) => win.evaluate(() => {
  const l = [...document.querySelectorAll("[role=tabpanel] label")].find((e) => e.innerText.trim() === "Duration");
  const box = l?.parentElement;
  if (!box) return null;
  const thumb = box.querySelector("[role=slider]");
  return { value: parseFloat(box.querySelector("input").value), min: +thumb?.getAttribute("aria-valuemin"), max: +thumb?.getAttribute("aria-valuemax") };
});

// Type `s` into the Duration field and press Enter.
export const setDuration = async (win, s) => {
  const input = win.locator("[role=tabpanel] label", { hasText: /^Duration$/ }).locator("xpath=..").locator("input");
  await input.click();
  await win.keyboard.press("Meta+A");
  await win.keyboard.type(String(s));
  await settled(win, () => win.keyboard.press("Enter"));
};

// The notes under the panel's sections.
export const note = (win) => win.evaluate(() => [...document.querySelectorAll("[role=tabpanel] p")].map((p) => p.innerText.trim()).join(" | "));

// The project the app saved last (its projects-json folder), once it has saved.
export const savedProject = async (win, udDir) => {
  await win.waitForTimeout(1500);
  const dir = path.join(udDir, "projects-json");
  const files = fs.readdirSync(dir).filter((f) => /^project-.*\.json$/.test(f)).map((f) => path.join(dir, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  // It may be half written: read it again a moment later.
  for (let i = 0; ; i++) {
    try {
      return JSON.parse(fs.readFileSync(files[0], "utf8"));
    } catch (e) {
      if (i === 5) throw e;
      await win.waitForTimeout(300);
    }
  }
};
export const savedClips = async (win, udDir) => (await savedProject(win, udDir)).timeline.clips;

// Where to click a clip's bar: its middle (or `at` seconds) on its track's row, for a saved
// clip whose id starts with `id`. Rows sit under the ruler (27 px) at the tracks' saved y.
export const bar = async (ctx, doc, id, at) => {
  const tl = await timelineRect(ctx.win);
  const clip = doc.timeline.clips.find((c) => c.clipId.startsWith(id));
  if (!clip) throw new Error(`no clip ${id}`);
  const track = doc.timeline.tracks.find((t) => t.timelineId === clip.timelineId);
  const s = at ?? (+clip.startTick + +clip.endTick) / 2e6;
  return [ctx.map.x(s), tl.y + 27 + track.timelineY + track.timelineHeight / 2];
};

// Select a clip by clicking its bar. A click on the playhead's line would grab the playhead
// instead: then it clicks a quarter of the way from the bar's farther end.
export const select = async (ctx, doc, id, at) => {
  let [x, y] = await bar(ctx, doc, id, at);
  const head = ctx.map.x(await now(ctx.win));
  if (Math.abs(x - head) < 10) {
    const clip = doc.timeline.clips.find((c) => c.clipId.startsWith(id));
    const [a, b] = [ctx.map.x(+clip.startTick / 1e6), ctx.map.x(+clip.endTick / 1e6)];
    x = head - a > b - head ? a + (head - a) / 2 : head + (b - head) / 2;
  }
  await ctx.win.mouse.click(x, y);
  await ctx.win.waitForTimeout(600);
};

// Select a clip and open its Animation tab.
export const pick = async (ctx, doc, id, at) => {
  await select(ctx, doc, id, at);
  await tab(ctx.win, "Animation");
};

// PASS/FAIL lines; `report` is what a step returns.
export const checks = () => {
  const lines = [];
  const check = (name, ok, detail = "") => {
    lines.push(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
    return ok;
  };
  const report = () => `${lines.filter((l) => l.startsWith("PASS")).length}/${lines.length} passed\n  ${lines.join("\n  ")}`;
  return { check, report };
};
