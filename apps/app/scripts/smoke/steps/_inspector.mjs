// Inspector helpers (the video and photo panels): tabs and sub-tabs by name, a row's field,
// diamond and select by its label, the clip as saved, and a keyframe case (a key at one time,
// an edit at another, the engine's frames differing over time, the edit undone).
import { engineFrame, now, rulerMap, seek, settled } from "./_preview.mjs";
import { savedProject, select } from "./_anim.mjs";

const PANEL = "[data-testid=inspector] [role=tabpanel]";

// Click an inspector tab, then (if given) one of its sub-tabs, by their names.
export const open = async (win, tab, sub) => {
  for (const name of [tab, sub].filter(Boolean)) {
    const at = await win.evaluate((name) => {
      const el = [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].find((e) => (e.innerText || "").trim() === name);
      if (!el) return null;
      el.scrollIntoView({ inline: "center", block: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, name);
    if (!at) throw new Error(`no ${name} tab`);
    await win.mouse.click(at.x, at.y);
    await win.waitForTimeout(400);
  }
};

const label = (win, text) => win.locator(`${PANEL} label`, { hasText: new RegExp(`^${text}$`) }).first();

// The n-th input of the row (or slider) labelled `text`: the nearest ancestor holding one.
export const input = (win, text, n = 0) => label(win, text).locator("xpath=ancestor::*[.//input][1]").locator("input").nth(n);

// Type a value into a row's field and press Enter, then wait for the engine's picture.
export const typeIn = async (win, text, value, n = 0) => {
  const el = input(win, text, n);
  await el.scrollIntoViewIfNeeded();
  await el.click({ clickCount: 3 });
  await el.fill(String(value));
  await settled(win, () => el.press("Enter"));
  await win.evaluate(() => document.activeElement?.blur?.());
};

// A row's keyframe navigator (the nearest one to its label), or a section header's.
const navOf = (win, text) => label(win, text).locator("xpath=ancestor::*[.//*[@data-keyframe]][1]").locator("[data-keyframe]").first();
export const sectionNav = (win, title) => win.locator(`${PANEL} [data-section="${title}"] > div [data-keyframe]`).first();
export const diamondOn = async (nav) => (await nav.getAttribute("data-at")) === "true";
export const pressDiamond = async (win, nav) => {
  await nav.scrollIntoViewIfNeeded();
  await settled(win, () => nav.locator("button[aria-pressed]").click());
};
export const rowNav = navOf;

// Pick an option in one of the inspector's dropdowns (by its aria-label).
export const choose = async (win, aria, option) => {
  await win.locator(`${PANEL} [aria-label="${aria}"]`).first().click();
  await win.waitForTimeout(300);
  await settled(win, () => win.getByRole("option", { name: option, exact: true }).click());
};

export const click = async (win, selector) => {
  const el = win.locator(`${PANEL} ${selector}`).first();
  await el.scrollIntoViewIfNeeded();
  await settled(win, () => el.click());
};

// The first video or photo as saved, and the saved clip by id.
export const mediaClip = async (ctx) => (await savedProject(ctx.win, ctx.udDir)).timeline.clips.find((c) => c.type === "video" || c.type === "image");
export const savedClip = async (ctx, id) => (await savedProject(ctx.win, ctx.udDir)).timeline.clips.find((c) => c.clipId === id);

// Move the playhead to `s` and select the clip again (a click on the ruler drops it).
export const at = async (ctx, id, s) => {
  ctx.map ??= await rulerMap(ctx.win);
  await seek(ctx.win, ctx.map, s);
  const doc = await savedProject(ctx.win, ctx.udDir);
  const clip = doc.timeline.clips.find((c) => c.clipId === id);
  const [a, b] = [+clip.startTick / 1e6, +clip.endTick / 1e6];
  await select(ctx, doc, id, s < (a + b) / 2 ? b - 0.4 : a + 0.4);
};

export const frame = async (win) => (await engineFrame(win)).sum;

/**
 * A property keyed through the panel: at `t1` the row's diamond adds a key (it fills), `set1`
 * gives it a value; at `t2` `set2` (an edit while keyed) adds a second key there. The engine's
 * frames at t1, t2 and halfway differ; ‹ goes back to t1; the second edit undoes and redoes as
 * one step. `reopen` (the tab and sub-tab) brings the panel back after a seek.
 */
export const keyCase = async (ctx, check, name, { id, row, t1, t2, set1, set2, reopen, undoCase }) => {
  const { win } = ctx;
  await at(ctx, id, t1);
  await reopen();
  const nav = typeof row === "string" ? navOf(win, row) : row();
  await pressDiamond(win, nav);
  const keyed = await diamondOn(nav);
  if (set1) await set1();
  const f1 = await frame(win);
  await at(ctx, id, t2);
  await reopen();
  const before = await diamondOn(typeof row === "string" ? navOf(win, row) : row());
  const r = await undoCase(ctx, check, `${name} keyed at a second time`, set2);
  const after = await diamondOn(typeof row === "string" ? navOf(win, row) : row());
  const f2 = await frame(win);
  await at(ctx, id, (t1 + t2) / 2);
  await reopen();
  const fm = await frame(win);
  // ‹ from halfway goes to the key at t1.
  const prev = (typeof row === "string" ? navOf(win, row) : row()).locator("button[aria-label='Previous keyframe']");
  await settled(win, () => prev.click());
  const back = await now(win);
  check(
    `${name}: the diamond keys it, an edit at another time keys it there, the frames move between`,
    keyed && !before && after && f1 !== f2 && fm !== f1 && fm !== f2 && Math.abs(back - t1) < 0.05 && r.ok,
    `diamond filled ${keyed}, at t2 before ${before} after ${after}; frames t1≠t2 ${f1 !== f2}, middle differs ${fm !== f1 && fm !== f2}; ‹ to ${back}`,
  );
};
