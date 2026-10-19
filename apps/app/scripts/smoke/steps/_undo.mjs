// Undo and redo helpers: an edit, ⌘Z and ⇧⌘Z, with the engine's frame and the project as
// saved compared after each; and the panels' fields and sliders found by their labels.
import { engineFrame, settled, tab } from "./_preview.mjs";
import { savedProject } from "./_anim.mjs";

// What undo puts back of the saved project: tracks, clips, markers, canvas, the main track
// magnet and which media are used (the editor's view, playhead and save times aren't part of it).
export const docOf = (p) =>
  JSON.stringify({
    tracks: p.timeline.tracks,
    clips: p.timeline.clips,
    markers: p.timeline.markers ?? [],
    aspect: p.settings.aspectRatio,
    canvas: p.settings.engineCanvas ?? null,
    fps: p.settings.fps,
    magnet: p.settings.mainTrackMagnet,
    assets: Object.keys(p.assets).sort(),
  });

// When the project file was last written.
const savedAt = (ctx) => {
  const dir = `${ctx.udDir}/projects-json`;
  return Math.max(0, ...ctx.fs.readdirSync(dir).filter((f) => /^project-.*\.json$/.test(f)).map((f) => ctx.fs.statSync(`${dir}/${f}`).mtimeMs));
};

// The engine's frame (its hash) and the saved project, once both have settled. With `since`
// (a time in ms), the project as written after it: the autosave can take a few seconds when
// the app is busy, so it waits for a write after the action (up to 8 s; an action that
// changes nothing writes nothing, and then it's the file as it was), then for the writes to
// stop for 0.8 s, since another save (the cover's, one queued before the action) can land
// first.
export const state = async (ctx, since) => {
  if (since != null) {
    for (let i = 0; i < 40 && savedAt(ctx) <= since; i++) await ctx.win.waitForTimeout(200);
    for (let i = 0, last = savedAt(ctx), quiet = 0; i < 40 && quiet < 4; i++) {
      await ctx.win.waitForTimeout(200);
      const t = savedAt(ctx);
      quiet = t === last ? quiet + 1 : 0;
      last = t;
    }
  }
  return { frame: (await engineFrame(ctx.win)).sum, doc: docOf(await savedProject(ctx.win, ctx.udDir)) };
};

// Keys with nothing focused (a field keeps ⌘Z for its own typing), then the picture settled.
export const press = async (win, keys) => {
  await win.evaluate(() => document.activeElement?.blur?.());
  await settled(win, () => win.keyboard.press(keys), { timeout: 3000 });
};

// `edit`, then ⌘Z and ⇧⌘Z: undo should give back the frame and saved project from before the
// edit exactly, and redo those after it. `frame: false` for edits the picture at the playhead
// doesn't show (a split, the volume): then only the project is compared. Returns the states.
export const undoCase = async (ctx, check, name, edit, { frame = true } = {}) => {
  const s0 = await state(ctx);
  await edit();
  await ctx.win.evaluate(() => document.activeElement?.blur?.());
  const s1 = await state(ctx, Date.now() - 400);
  await press(ctx.win, "Meta+z");
  const s2 = await state(ctx, Date.now() - 400);
  await press(ctx.win, "Meta+Shift+z");
  const s3 = await state(ctx, Date.now() - 400);
  const changed = s1.doc !== s0.doc && (!frame || s1.frame !== s0.frame);
  const same = (a, b) => a.doc === b.doc && (!frame || a.frame === b.frame);
  const ok = check(
    `${name}: undo gives back the ${frame ? "frame and the " : ""}saved project, redo the edit`,
    changed && same(s2, s0) && same(s3, s1),
    `edit changed ${frame ? `the frame ${s1.frame !== s0.frame}, ` : ""}the project ${s1.doc !== s0.doc}; ` +
      `undone: frame ${s2.frame === s0.frame}, project ${s2.doc === s0.doc}; redone: frame ${s3.frame === s1.frame}, project ${s3.doc === s1.doc}`,
  );
  // The four projects, to compare when it fails.
  if (!ok) [s0, s1, s2, s3].forEach((s, i) => ctx.fs.writeFileSync(`${ctx.outDir}/u-${name}-${i}.json`, JSON.stringify(JSON.parse(s.doc), null, 1)));
  return { ok, before: s0, after: s1 };
};

// Open an inspector tab (tab() scrolls the strip to it).
export const openTab = (win, name) => tab(win, name);

// Text ▸ Basic's controls (components/properties/text), each waiting for the engine's picture:
// a Case button ("uppercase", "lowercase", "capitalize"), a font from the font menu, and a
// colour typed into a well's picker (`well` its test id: text-color, text-stroke-color, …).
export const textCase = (win, value) => settled(win, () => win.locator(`[data-testid=inspector] [data-testid=text-case] [data-value=${value}]`).click());
export const textFont = (win, family) =>
  settled(win, async () => {
    await win.locator("[data-testid=text-font]").click();
    await win.locator("[data-testid=font-search]").fill(family);
    await win.waitForTimeout(300);
    await win.locator(`[role=listbox] [data-font="${family}"]`).first().click();
  });
export const textColor = (win, well, hex) =>
  settled(win, async () => {
    const w = win.locator(`[data-testid=${well}]`);
    await w.scrollIntoViewIfNeeded();
    await w.click();
    const f = win.locator("[data-testid=color-hex]");
    await f.fill(hex.replace("#", ""));
    await f.press("Enter");
    await win.keyboard.press("Escape");
  });

// The number field under a panel label ("Position", "Volume", …).
export const field = (win, label) =>
  win.locator("[data-testid=inspector] [role=tabpanel] label", { hasText: new RegExp(`^${label}$`) }).first().locator("xpath=..").locator("xpath=..").locator("input").first();

// Type `value` into the field under `label` and press Enter.
export const typeInto = async (win, label, value) => {
  const input = field(win, label);
  await input.scrollIntoViewIfNeeded();
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await settled(win, () => input.press("Enter"));
};

// Where a slider's thumb is (the slider under `label`), scrolled into view.
export const thumb = (win, label) =>
  win.evaluate((label) => {
    const l = [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] label")].find((e) => e.innerText.trim() === label);
    const t = l?.parentElement?.querySelector("[role=slider]");
    if (!t) return null;
    t.scrollIntoView({ block: "center" });
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
