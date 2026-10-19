// The editor's shell (after import timeline newtext): each left-panel tab, the inspector's
// tabs for the text and the video, the Text tab's styles and the Transitions tab acting on
// the selection, the player's safe areas and ratio menu, and the layouts, with a shot of each.
import { drag, engineFrame, rulerMap, settled, sectionButton } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { openTab } from "./_undo.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const doc = () => savedProject(win, udDir);
  const clipOf = async (type) => (await doc()).timeline.clips.filter((c) => c.type === type).sort((a, b) => +a.startTick - +b.startTick)[0];
  const tabs = () => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  const left = async (name) => {
    await win.locator(`[data-testid=assets-tab-${name}]`).click();
    await win.waitForTimeout(600);
  };

  // Every left tab shows something: a library, or what's coming.
  for (const name of ["audio", "text", "stickers", "effects", "transitions", "captions", "filters", "adjustment", "templates", "media"]) {
    await left(name);
    await shot(`l-${name}`);
    // The library beside the tab's sections: words, or tiles (Stickers ▸ Shapes has no labels,
    // as CapCut's hasn't).
    const text = (await win.locator("[data-testid=assets-content]").innerText()).replace(/\s+/g, " ").trim();
    const tiles = await win.locator("[data-testid=assets-content] [data-testid^=shape-], [data-testid=assets-content] button").count();
    check(`left tab ${name} has content`, text.length > 20 || tiles >= 4 || (name === "adjustment" && (await win.locator("[data-testid=adjustment-custom]").count()) === 1), text.slice(0, 60) || `${tiles} tiles`);
  }

  // The inspector's tabs follow the selection.
  await select(ctx, await doc(), (await clipOf("text")).clipId, 1.5);
  check("a text's tabs: Text, Animation, Tracking, Duration", (await tabs()).startsWith("Text,Animation,Tracking,Duration"), await tabs());
  await openTab(win, "Transform");
  await shot("i-text-transform");
  await select(ctx, await doc(), (await clipOf("video")).clipId, 6);
  check("a video's tabs: Video, (Audio,) Speed, Animation, Adjust", /^Video,(Audio,)?Speed,Animation,Adjust,Basic,Remove BG,Mask$/.test(await tabs()), await tabs());
  await openTab(win, "Mask");
  await shot("i-video-mask");
  await openTab(win, "Adjust");
  await shot("i-video-adjust");

  // A text style from the Text tab: a new text clip, selected, on its Text tab.
  const texts = (await doc()).timeline.clips.filter((c) => c.type === "text").length;
  await left("text");
  await (await sectionButton(win, "presets:All")).click();
  await settled(win, () => win.locator("[data-testid=text-preset-outline]").click());
  const after = (await doc()).timeline.clips.filter((c) => c.type === "text");
  check("Text tab: a style adds a text at the playhead", after.length === texts + 1 && after.some((c) => c.strokeEnabled), `${texts} → ${after.length} texts`);
  check("Text tab: the new text is selected on its Text tab", (await tabs()).startsWith("Text,"), await tabs());
  await shot("l-text-added");
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(800);
  check("Text tab: one undo takes it back", (await doc()).timeline.clips.filter((c) => c.type === "text").length === texts);

  // The Transitions tab with the lone video selected: it has no cut, so the tab says so and its
  // cards' + is off (transui puts them on cuts).
  await select(ctx, await doc(), (await clipOf("video")).clipId, 6);
  await left("transitions");
  const tnote = (await win.locator("[data-testid=assets-content]").innerText()).replace(/\s+/g, " ");
  check("Transitions tab: a lone clip has no cut, the tab says so", /between two clips/.test(tnote), tnote.slice(0, 80));
  // White Flash is under Light.
  await (await sectionButton(win, "Light")).click().catch(() => {});
  await win.waitForTimeout(300);
  await win.locator("[data-testid=transition-white_flash]").hover();
  await win.waitForTimeout(300);
  check("Transitions tab: its cards' + is off", await win.locator("[data-testid=transition-add-white_flash]").isDisabled());
  await shot("l-transition");
  check("Transitions tab: nothing given to the video", !(await clipOf("video")).transitionOut);
  await left("media");

  // Safe areas (the bottom bar's toggle, where CapCut has its platform overlay) and the ratio
  // menu, under the player.
  const guides = async () => {
    await win.locator("[data-testid=safe-areas-button]").click();
    await win.waitForTimeout(300);
  };
  await guides();
  check("safe areas drawn", (await win.locator("[data-testid=safe-area-guides]").count()) === 1);
  await shot("p-safe-areas");
  await guides();
  // The empty inspector's Details (a click on the ruler drops the selection): where the
  // project is saved.
  await win.mouse.click(map.x(0.5), map.y);
  await win.waitForTimeout(400);
  // It opens on Project (Global edits), as CapCut's does; Details is the other tab.
  await shot("i-project-tab");
  await win.locator("[data-testid=project-tab-details]").click();
  await win.waitForTimeout(300);
  const details =(await win.locator("[data-testid=inspector]").innerText()).replace(/\s+/g, " ");
  check("the project's details say where it's saved", /Path: .*project-\d+\.json/.test(details), details.slice(0, 120));
  await shot("i-project-details");
  await win.locator("[data-testid=ratio-menu]").click();
  await win.waitForTimeout(400);
  await shot("p-ratio-menu");
  check("ratio menu lists the sizes", (await win.getByRole("menuitem").count()) >= 8);
  await win.keyboard.press("Escape");

  // The frame before the layouts: a step run earlier in the session can leave the picture dark
  // (canvastools' rectangle and brush masks intersect to nothing), so "still draws" means a
  // drawn frame as bright as this one, not a bright frame.
  const before = await engineFrame(win);
  // The layouts, and back to Default.
  for (const id of ["media", "properties", "vertical", "default"]) {
    await win.locator("[data-testid=layout-menu]").click();
    await win.waitForTimeout(300);
    await win.locator(`[data-testid=layout-${id}]`).click();
    await win.waitForTimeout(1200);
    await shot(`layout-${id}`);
  }
  // A panel dragged wider keeps its size (saved per layout, read back on the next start).
  const handle = await win.evaluate(() => {
    const r = [...document.querySelectorAll("[data-panel-resize-handle-id]")].map((e) => e.getBoundingClientRect()).find((b) => b.height > 200 && b.x < innerWidth / 2);
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  const width = async () => (await win.locator("[data-testid=assets]").boundingBox()).width;
  const w0 = await width();
  if (handle) await drag(win, handle.x, handle.y, handle.x + 60, handle.y);
  await win.waitForTimeout(800);
  const saved = await win.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes("openrip:layout:default")).map(([k, v]) => `${k}=${v.slice(0, 80)}`));
  check("a dragged panel's size is saved", handle && (await width()) > w0 + 40 && saved.some((s) => s.includes(":upper")), `${w0.toFixed(0)} → ${(await width()).toFixed(0)} px; ${saved.join(" | ")}`);
  ctx.panelWidth = await width();
  // The frame for the panel's new width is rendered and handed over asynchronously (it can be
  // slow on a busy machine), so wait, up to 6 s, for a drawn frame rather than read once.
  const drawn = (f) => f.w > 16 && (f.light > 0.05 || f.light >= before.light - 0.01);
  const t0 = Date.now();
  let frame = await engineFrame(win);
  while (!drawn(frame) && Date.now() - t0 < 6000) {
    await win.waitForTimeout(150);
    frame = await engineFrame(win);
  }
  const { count: _unused, ...seen } = frame;
  check("the engine still draws after the layouts", drawn(frame), `${JSON.stringify(seen)} after ${Date.now() - t0} ms (light before ${before.light.toFixed(3)})`);
  return report();
};
