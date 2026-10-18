// Undo and redo of each kind of edit on the app's own project (after import timeline newtext:
// the 10 s standard clip with a text 0–3 s over it). Each edit is undone with ⌘Z and redone
// with ⇧⌘Z: the engine's frame and the saved project should come back exactly (see
// _undo.mjs). Then everything is undone at once back to the start and redone, by the
// toolbar's buttons. UNDO_CASES="a,b" runs some of the cases only.
import { clickSplit, drag, previewRect, seek, settled, timelineRect } from "./_preview.mjs";
import { addTransition, bar, checks, choose, savedProject, select } from "./_anim.mjs";
import { field, openTab, press, state, textCase, textColor, textFont, thumb, typeInto, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, udDir } = ctx;
  const map = ctx.map;
  const { check, report } = checks();
  const doc = () => savedProject(win, udDir);
  const clipOf = async (type, i = 0) => (await doc()).timeline.clips.filter((c) => c.type === type).sort((a, b) => +a.startTick - +b.startTick)[i];
  const pick = async (type, i = 0, at) => select(ctx, await doc(), (await clipOf(type, i)).clipId, at);
  const p = await previewRect(win);
  const mid = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  const toolbar = (title) => win.locator(`[title=${title}]`);
  const enabled = async (title) => !(await toolbar(title).getAttribute("class")).includes("not-allowed");

  const CASES = {
    // Transform: the text dragged on the canvas, the video's position typed in.
    canvas: () => settled(win, () => drag(win, mid.x, mid.y, mid.x + 40, mid.y - 90)),
    position: async () => {
      await pick("video", 0, 6);
      await openTab(win, "Transform");
      await typeInto(win, "Position", 40);
    },
    // A slider dragged across: many changes, one step (undo must land on the value before it).
    slider: async () => {
      await pick("video", 0, 6);
      await openTab(win, "Adjust");
      const t = await thumb(win, "Brilliance");
      await settled(win, () => drag(win, t.x, t.y, t.x + 60, t.y));
    },
    volume: async () => {
      await pick("video", 0, 6);
      await openTab(win, "Audio");
      const t = await thumb(win, "Volume");
      await settled(win, () => drag(win, t.x, t.y, t.x - 50, t.y));
    },
    mask: async () => {
      await pick("video", 0, 6);
      // The Mask tab's Rectangle tile: a rectangle mask centred on the picture, as CapCut adds
      // one (the player has no tool row).
      await openTab(win, "Mask");
      await settled(win, () => win.locator("[data-testid=mask-shape-rectangle]").click());
    },
    // Text and its style.
    uppercase: async () => {
      await pick("text", 0);
      await openTab(win, "Text");
      await textCase(win, "uppercase");
    },
    color: async () => {
      await pick("text", 0);
      await openTab(win, "Text");
      await textColor(win, "text-color", "ff3030");
    },
    font: async () => {
      await pick("text", 0);
      await openTab(win, "Text");
      await textFont(win, "Georgia");
    },
    // The text's In animation, seen a quarter of a second in.
    animation: async () => {
      await pick("text", 0);
      await openTab(win, "Animation");
      await choose(win, "Animation", "Type 1");
    },
    // Timeline edits. The text bar moved a second later (seen at 0.5 s), then its end trimmed
    // back a second (seen at 3.5 s).
    move: async () => {
      const [x, y] = await bar(ctx, await doc(), (await clipOf("text")).clipId, 2);
      await settled(win, () => drag(win, x, y, x + map.pps, y));
    },
    trim: async () => {
      const text = await clipOf("text");
      await pick("text", 0);
      const end = +text.endTick / 1e6;
      const [, y] = await bar(ctx, await doc(), text.clipId);
      await settled(win, () => drag(win, map.x(end) - 1, y, map.x(end - 1), y));
    },
    // By the toolbar's split button.
    split: async () => {
      await pick("video", 0, 2);
      await settled(win, () => clickSplit(win));
    },
    // A White Flash on the cut into the second half (the Transitions tab's +), seen at the cut.
    transition: async () => {
      await pick("video", 0, 2);
      await addTransition(win, "White Flash");
    },
    delete: async () => {
      await pick("text", 0);
      await press(win, "Backspace");
    },
    add: async () => {
      await win.keyboard.press("t");
      await settled(win, () => drag(win, mid.x - 80, mid.y - 140, mid.x + 80, mid.y - 90));
      await win.keyboard.press("Escape");
      await win.keyboard.press("v");
      await win.waitForTimeout(500);
    },
    // A filter from the Filters panel dropped on the timeline from 1 s, then its intensity.
    filter: async () => {
      await win.locator("[data-testid=assets-tab-filters]").click();
      await win.waitForTimeout(1000);
      // A warm one: it tints even a black-and-white picture.
      const from = await win.evaluate(() => {
        const el = [...document.querySelectorAll("img[alt]")].find((e) => /Warm/.test(e.getAttribute("alt")));
        el?.scrollIntoView({ inline: "center", block: "center" });
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (!from) throw new Error("no filter in the panel");
      // Just above the first track, where a new track can go (rows sit 27 px under the ruler).
      const y = (await timelineRect(win)).y + 27 - 12;
      await settled(win, async () => {
        await win.mouse.move(from.x, from.y);
        await win.mouse.down();
        await win.mouse.move(from.x + 10, from.y + 10, { steps: 5 });
        await win.mouse.move(map.x(1), y, { steps: 25 });
        await win.waitForTimeout(300);
        await win.mouse.up();
      });
      await win.locator("[data-testid=assets-tab-media]").click();
    },
    intensity: async () => {
      await pick("filter", 0);
      await openTab(win, "Filters");
      await typeInto(win, "Intensity", 30);
    },
    // The video's halves grouped (⌘G with both selected).
    group: async () => {
      await pick("video", 0, 2);
      const [x, y] = await bar(ctx, await doc(), (await clipOf("video", 1)).clipId, 8);
      await win.keyboard.down("Shift");
      await win.mouse.click(x, y);
      await win.keyboard.up("Shift");
      await win.waitForTimeout(400);
      await press(win, "Meta+g");
    },
    // The video track hidden by its eye in the track list (opened by dragging its rail).
    track: async () => {
      const [, y] = await bar(ctx, await doc(), (await clipOf("video")).clipId, 2);
      const rail = await win.locator("button[aria-label='Drag to resize timeline sidebar']").boundingBox();
      if (rail.x < 60) await drag(win, rail.x, rail.y + rail.height / 2, rail.x + 40, rail.y + rail.height / 2);
      await win.waitForTimeout(500);
      const eye = await win.evaluate((y) => {
        const b = [...document.querySelectorAll("button[title='Hide track']")].map((e) => e.getBoundingClientRect()).filter((r) => r.x < 200 && Math.abs(r.y + r.height / 2 - y) < 20);
        const r = b[b.length - 1];
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      }, y);
      if (!eye) throw new Error(`no track buttons at y ${y}`);
      await settled(win, () => win.mouse.click(eye.x, eye.y));
    },
    aspect: async () => {
      await win.locator("[data-testid=ratio-menu]").click();
      await win.waitForTimeout(500);
      await settled(win, () => win.getByRole("menuitem").filter({ hasText: "Square" }).first().click());
      await win.keyboard.press("Escape");
    },
  };
  // Where the playhead goes for a case, to see its edit (1.5 s otherwise); the edits the
  // picture doesn't show compare only the project.
  const AT = { animation: 0.25, move: 0.5, trim: 3.5, split: 5, transition: 5, delete: 2.5, filter: 3, intensity: 3 };
  const NO_FRAME = ["split", "volume", "group"];
  const only = (process.env.UNDO_CASES || "").split(",").filter(Boolean);
  await seek(win, map, 1.5);
  const start = await state(ctx);
  let done = 0;
  for (const [name, edit] of Object.entries(CASES)) {
    if (only.length && !only.includes(name)) continue;
    await seek(win, map, AT[name] ?? 1.5);
    try {
      const r = await undoCase(ctx, check, name, edit, { frame: !NO_FRAME.includes(name) });
      if (r.ok) done++;
      else await ctx.shot(`u-fail-${name}`);
    } catch (e) {
      check(name, false, e.message.split("\n")[0]);
      await ctx.shot(`u-fail-${name}`);
    }
  }
  await seek(win, map, 1.5);
  const tabs = () => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  if (!only.length) {
    // A field keeps ⌘Z for its typing: nothing in the project is undone.
    await pick("text", 0);
    await openTab(win, "Transform");
    const before = await state(ctx);
    const input = field(win, "Position");
    await input.click({ clickCount: 3 });
    await win.keyboard.type("123");
    await win.keyboard.press("Meta+z");
    await win.keyboard.press("Escape");
    await win.waitForTimeout(500);
    const after = await state(ctx);
    check("⌘Z in a field leaves the project alone", after.doc === before.doc && !(await enabled("Redo")), `project unchanged ${after.doc === before.doc}`);
    // Undo selects what was selected before the edit: a deleted text comes back selected.
    await pick("text", 0);
    await press(win, "Backspace");
    const gone = await tabs();
    await press(win, "Meta+z");
    const back = await tabs();
    check("undo selects the clips from before the edit", !gone.includes("Text") && back.includes("Text"), `tabs after the delete "${gone}", after undo "${back}"`);
    await press(win, "Meta+Shift+z");
  }
  // Everything back by the toolbar's Undo, to the project as opened (empty: the clip and the
  // text were added in this session), then forward again by Redo.
  const end = await state(ctx);
  let undos = 0;
  while ((await enabled("Undo")) && undos < 80) {
    await settled(win, () => toolbar("Undo").click(), { timeout: 1500 });
    undos++;
  }
  const back = JSON.parse((await state(ctx)).doc);
  check("the toolbar's Undo goes back to the project as opened", back.clips.length === 0 && back.tracks.length === 0, `${undos} steps; ${back.clips.length} clips, ${back.tracks.length} tracks left`);
  let redos = 0;
  while ((await enabled("Redo")) && redos < 80) {
    await settled(win, () => toolbar("Redo").click(), { timeout: 1500 });
    redos++;
  }
  await seek(win, map, 1.5);
  const forward = await state(ctx);
  check("the toolbar's Redo brings every step back", forward.doc === end.doc && forward.frame === end.frame && redos === undos, `${redos} redone; frame ${forward.frame === end.frame}, project ${forward.doc === end.doc}`);
  return `${done} of ${Object.keys(CASES).length} cases; ${undos} steps in all (from ${JSON.parse(start.doc).clips.length} clips)\n  ` + report();
};
