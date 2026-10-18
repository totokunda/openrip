// The editor's shell (after import timeline newtext): each left-panel tab, the inspector's
// tabs for the text and the video, the Text tab's styles and the Transitions tab acting on
// the selection, the player's safe areas and ratio menu, and the layouts, with a shot of each.
import { drag, engineFrame, rulerMap, settled } from "./_preview.mjs";
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
    // The library beside the tab's sections.
    const text = (await win.locator("[data-testid=assets-content]").innerText()).replace(/\s+/g, " ").trim();
    check(`left tab ${name} has content`, text.length > 20, text.slice(0, 60));
  }

  // The inspector's tabs follow the selection.
  await select(ctx, await doc(), (await clipOf("text")).clipId, 1.5);
  check("a text's tabs: Text, Animation, Duration", (await tabs()).startsWith("Text,Animation,Duration"), await tabs());
  await openTab(win, "Transform");
  await shot("i-text-transform");
  await select(ctx, await doc(), (await clipOf("video")).clipId, 6);
  check("a video's tabs: Video, (Audio,) Speed, Animation, Adjust", /^Video,(Audio,)?Speed,Animation,Adjust,Basic,Mask$/.test(await tabs()), await tabs());
  await openTab(win, "Mask");
  await shot("i-video-mask");
  await openTab(win, "Adjust");
  await shot("i-video-adjust");

  // A text style from the Text tab: a new text clip, selected, on its Text tab.
  const texts = (await doc()).timeline.clips.filter((c) => c.type === "text").length;
  await left("text");
  await win.locator("[data-testid=assets-section-styles]").click();
  await settled(win, () => win.locator("[data-testid=text-preset-outline]").click());
  const after = (await doc()).timeline.clips.filter((c) => c.type === "text");
  check("Text tab: a style adds a text at the playhead", after.length === texts + 1 && after.some((c) => c.strokeEnabled), `${texts} → ${after.length} texts`);
  check("Text tab: the new text is selected on its Text tab", (await tabs()).startsWith("Text,"), await tabs());
  await shot("l-text-added");
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(800);
  check("Text tab: one undo takes it back", (await doc()).timeline.clips.filter((c) => c.type === "text").length === texts);

  // A transition from the Transitions tab, on the video (nothing follows it: the note says so).
  await select(ctx, await doc(), (await clipOf("video")).clipId, 6);
  await left("transitions");
  await win.locator("[data-testid=transition-white_flash]").click();
  await win.waitForTimeout(800);
  const v = await clipOf("video");
  check("Transitions tab: White Flash given to the video", v.transitionOut?.type === "white_flash", JSON.stringify(v.transitionOut));
  check("Transitions tab: the inspector shows Animation", (await win.locator("[data-testid=inspector] [role=tab][data-state=active]").first().innerText()).trim() === "Animation");
  await shot("l-transition");
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(800);
  await left("media");

  // Safe areas (the player's menu) and the ratio menu, under the player.
  const guides = async () => {
    await win.locator("[data-testid=player-menu]").click();
    await win.waitForTimeout(300);
    await win.locator("[data-testid=safe-areas]").click();
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
  const details = (await win.locator("[data-testid=inspector]").innerText()).replace(/\s+/g, " ");
  check("the project's details say where it's saved", /Path: .*project-\d+\.json/.test(details), details.slice(0, 120));
  await shot("i-project-details");
  await win.locator("[data-testid=ratio-menu]").click();
  await win.waitForTimeout(400);
  await shot("p-ratio-menu");
  check("ratio menu lists the sizes", (await win.getByRole("menuitem").count()) >= 8);
  await win.keyboard.press("Escape");

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
  const frame = await engineFrame(win);
  check("the engine still draws after the layouts", frame.w > 16 && frame.light > 0.05, JSON.stringify(frame));
  return report();
};
