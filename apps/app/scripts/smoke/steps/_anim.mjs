// Animation tab helpers: its sub-tabs' cards (In, Out, Combo, Loop; "Animation" is In), the
// caption style's select ("Words"), the Duration slider and the note under the cards; the
// transition on a cut (its marker, the Transitions tab's cards and its inspector); the project
// as saved; and a log of checks.
import fs from "node:fs";
import path from "node:path";
import { now, rulerMap, seek, settled, tab, timelineRect } from "./_preview.mjs";

// The Animation tab's sub-tab a label names.
const KIND = { Animation: "In", In: "In", Out: "Out", Combo: "Combo", Loop: "Loop" };

// Open the Animation tab's sub-tab `name` ("In", …) if the clip has it; false if not.
const openKind = async (win, name) => {
  const at = await win.evaluate((name) => {
    const el = [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].find((e) => (e.innerText || "").trim() === name);
    if (!el) return null;
    if (el.getAttribute("data-state") === "active") return "active";
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  if (!at) return false;
  if (at !== "active") {
    await win.mouse.click(at.x, at.y);
    await win.waitForTimeout(300);
  }
  return true;
};

// The names on the open sub-tab's cards, and which is chosen.
const cards = (win) =>
  win.evaluate(() =>
    [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] [data-testid=anim-card]")].map((b) => ({ name: b.getAttribute("title"), on: b.getAttribute("aria-pressed") === "true" })),
  );

// The chosen card on the Animation tab's sub-tab `label` ("Animation" or "In", "Out", …), or
// the caption style's select ("Words"): its shown value, or null when the clip has no such row.
export const selected = async (win, label) => {
  if (KIND[label]) {
    if (!(await openKind(win, KIND[label]))) return null;
    return (await cards(win)).find((c) => c.on)?.name ?? null;
  }
  return win.evaluate((label) => {
    const h = [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] h4")].find((e) => e.innerText.trim() === label);
    return h?.parentElement?.querySelector("[role=combobox]")?.innerText.trim() ?? null;
  }, label);
};

const openSelect = async (win, label) => {
  const at = await win.evaluate((label) => {
    const h = [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] h4")].find((e) => e.innerText.trim() === label);
    const r = h?.parentElement?.querySelector("[role=combobox]")?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, label);
  if (!at) throw new Error(`no ${label} select`);
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(400);
};

// What the sub-tab's cards (or the row's select) offer, in order.
export const options = async (win, label) => {
  if (KIND[label]) {
    if (!(await openKind(win, KIND[label]))) throw new Error(`no ${label} sub-tab`);
    return (await cards(win)).map((c) => c.name);
  }
  await openSelect(win, label);
  const names = await win.getByRole("option").allInnerTexts();
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
  return names.map((n) => n.trim());
};

// Pick the card `option` on the sub-tab (or the option in the row's select) and wait for the
// engine's picture.
export const choose = async (win, label, option) => {
  if (KIND[label]) {
    if (!(await openKind(win, KIND[label]))) throw new Error(`no ${label} sub-tab`);
    const card = win.locator(`[data-testid=inspector] [role=tabpanel] [data-testid=anim-card][title="${option}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await settled(win, () => card.click());
    return;
  }
  await openSelect(win, label);
  await settled(win, () => win.getByRole("option", { name: option, exact: true }).click());
};

// ---- transitions on cuts --------------------------------------------------------------------

// The transitions' ids by the names the steps use.
export const TRANSITION_IDS = {
  Mix: "mix",
  "Black Fade": "black_fade",
  "White Flash": "white_flash",
  "White Fade": "white_fade",
  "Pull in": "pull_in",
  "Pull out": "pull_out",
  Blur: "blur",
  Blink: "blink",
  Slide: "slide",
  Push: "push",
  Wipe: "wipe",
  Circle: "circle",
  Spin: "spin",
};

// Where the marker of the transition after a saved clip is: on its cut, on its row.
export const markerAt = async (ctx, doc, id) => {
  ctx.map ??= await rulerMap(ctx.win);
  const clip = doc.timeline.clips.find((c) => c.clipId.startsWith(id));
  if (!clip) throw new Error(`no clip ${id}`);
  const [, y] = await bar(ctx, doc, clip.clipId);
  return [ctx.map.x(+clip.endTick / 1e6), y];
};

// Select the transition after a saved clip by clicking its marker; true when its inspector
// shows. A playhead on the cut would take the click (its line grabs 6 px either side): it
// moves half a second before the cut first.
export const pickTransition = async (ctx, doc, id) => {
  const [x, y] = await markerAt(ctx, doc, id);
  const clip = doc.timeline.clips.find((c) => c.clipId.startsWith(id));
  if (Math.abs(ctx.map.x(await now(ctx.win)) - x) < 12) await seek(ctx.win, ctx.map, Math.round((+clip.endTick / 1e6 - 0.5) * 24) / 24);
  await ctx.win.mouse.click(x, y);
  await ctx.win.waitForTimeout(500);
  return (await ctx.win.locator("[data-testid=inspector-transition]").count()) > 0;
};

// The selected transition's name in its inspector, or null when it isn't shown.
export const transitionName = async (win) => {
  const el = win.locator("[data-testid=transition-name]");
  return (await el.count()) ? (await el.innerText()).trim() : null;
};

// The Transitions tab, on the category with the card for `name` (its column lists them).
export const openTransitionCard = async (win, name) => {
  const type = TRANSITION_IDS[name] ?? name;
  await win.locator("[data-testid=assets-tab-transitions]").click();
  await win.waitForTimeout(300);
  const card = win.locator(`[data-testid=transition-${type}]`);
  if (await card.count()) return card;
  for (const s of await win.locator("[data-testid=assets] nav[aria-label=Sections] [data-testid^=assets-section-]").all()) {
    await s.click();
    await win.waitForTimeout(250);
    if (await card.count()) return card;
  }
  return null;
};

// The transitions the Transitions tab offers, by name, across its categories.
export const transitionsOffered = async (win) => {
  await win.locator("[data-testid=assets-tab-transitions]").click();
  await win.waitForTimeout(300);
  const names = [];
  for (const s of await win.locator("[data-testid=assets] nav[aria-label=Sections] [data-testid^=assets-section-]").all()) {
    await s.click();
    await win.waitForTimeout(250);
    for (const t of await win.locator("[data-testid^=transition-card-] [title]").all()) names.push(await t.getAttribute("title"));
  }
  return names;
};

// Give the selected clip's cut the transition `name` by its card's "+" in the Transitions tab;
// the transition is then selected (its inspector shows) and the engine's picture settled.
export const addTransition = async (win, name) => {
  const card = await openTransitionCard(win, name);
  if (!card) throw new Error(`no ${name} card`);
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await win.waitForTimeout(200);
  await settled(win, () => win.locator(`[data-testid=transition-add-${TRANSITION_IDS[name] ?? name}]`).click());
};

// Delete the selected transition (⌫, nothing focused).
export const deleteTransition = async (win) => {
  await win.evaluate(() => document.activeElement?.blur?.());
  await settled(win, () => win.keyboard.press("Backspace"));
};

// The Duration slider's value in seconds, its bounds, or null when it isn't shown.
export const duration = (win) => win.evaluate(() => {
  const l = [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] label")].find((e) => e.innerText.trim() === "Duration");
  const box = l?.parentElement;
  if (!box) return null;
  const thumb = box.querySelector("[role=slider]");
  return { value: parseFloat(box.querySelector("input").value), min: +thumb?.getAttribute("aria-valuemin"), max: +thumb?.getAttribute("aria-valuemax") };
});

// Type `s` into the Duration field and press Enter.
export const setDuration = async (win, s) => {
  const input = win.locator("[data-testid=inspector] [role=tabpanel] label", { hasText: /^Duration$/ }).locator("xpath=..").locator("input");
  await input.click();
  await win.keyboard.press("Meta+A");
  await win.keyboard.type(String(s));
  await settled(win, () => win.keyboard.press("Enter"));
};

// The notes under the panel's sections.
export const note = (win) => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] p")].map((p) => p.innerText.trim()).join(" | "));

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

// The saved clips `pred` accepts, earliest first.
export const clipsWhere = (doc, pred) => doc.timeline.clips.filter(pred).sort((a, b) => +a.startTick - +b.startTick);

// The y of the timeline row of the first clip of `type` (TEXT_ROW or VIDEO_ROW, CSS px,
// override it), from the project as saved.
export const rowOf = async (ctx, type) => {
  const env = process.env[type === "text" ? "TEXT_ROW" : "VIDEO_ROW"];
  if (env) return +env;
  ctx.map ??= await rulerMap(ctx.win);
  const doc = await savedProject(ctx.win, ctx.udDir);
  const clip = clipsWhere(doc, (c) => c.type === type)[0];
  if (!clip) throw new Error(`no ${type} clip`);
  return (await bar(ctx, doc, clip.clipId))[1];
};

// Put the playhead inside a saved clip (a quarter of the way in, or at `at` s) and select it
// by its bar three quarters in, well off the playhead's line: its picture in the engine's
// frame, its tabs in the inspector.
export const focus = async (ctx, doc, clip, at) => {
  ctx.map ??= await rulerMap(ctx.win);
  const [a, b] = [+clip.startTick / 1e6, +clip.endTick / 1e6];
  await seek(ctx.win, ctx.map, at ?? Math.round((a + (b - a) / 4) * 24) / 24);
  await select(ctx, doc, clip.clipId, at == null ? a + ((b - a) * 3) / 4 : undefined);
};

// Select a clip by clicking its bar. A click on the playhead's line would grab the playhead
// instead: then it clicks a quarter of the way from the bar's farther end.
export const select = async (ctx, doc, id, at) => {
  let [x, y] = await bar(ctx, doc, id, at);
  const head = ctx.map.x(await now(ctx.win));
  if (Math.abs(x - head) < 16) {
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

// PASS/FAIL lines; `report` is what a step returns. CHECKS_LIVE=1 prints each as it's made
// (a step that throws later doesn't return its report).
export const checks = () => {
  const lines = [];
  const check = (name, ok, detail = "") => {
    lines.push(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
    if (process.env.CHECKS_LIVE) console.log(`  live: ${lines[lines.length - 1]}`);
    return ok;
  };
  const report = () => `${lines.filter((l) => l.startsWith("PASS")).length}/${lines.length} passed\n  ${lines.join("\n  ")}`;
  return { check, report };
};
