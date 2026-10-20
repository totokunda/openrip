// Sound while scrubbing (after `import timeline`; run on ~/Downloads/IMG_9079.MOV with
// CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1; docs/plan/capcut-ui-spec.md §6.3, §6.26):
//   Setting   Settings > Edit > Play audio while scrubbing is a toggle, off by default (CapCut's),
//             saved in the preferences
//   Off       dragging the playhead, stepping with the arrow keys, or skimming plays no snippets
//   On        a drag plays snippets at the positions it passes (the engine counts them even with
//             the speakers muted: window[btoa("engineScrubAudioStats")]), an arrow step one more,
//             and none follow when the drag stops
//   Axis      Preview axis > Preview video and audio: skimming the timeline plays snippets (with
//             the setting off too); Preview video only, or the toggle off, plays none
// Shots: `sa1-setting-off`, `sa2-setting-on` (CapCut's 02-settings/005-edit), `sa3-axis-menu`
// (30-timeline-toolbar/027-preview-axis-menu).
import { checks } from "./_anim.mjs";
import { now, rulerMap, seek } from "./_preview.mjs";
import { button } from "./_timeline.mjs";
import { openSettingsFromEditor, prefsOf, saveSettings, settingsTab } from "./_settings.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const stats = () => win.evaluate(() => window[btoa("engineScrubAudioStats")]());
  const count = async () => (await stats())?.snippets ?? -1;
  const toggle = () => win.locator("[data-testid=settings-scrub-audio]");

  // The playhead's handle, to drag it as a hand does (moves spaced like a mouse's).
  const handle = () =>
    win.evaluate(() => {
      const el = [...document.querySelectorAll("div.cursor-col-resize")].find((d) => d.className.includes("z-50"));
      const r = el.firstElementChild.firstElementChild.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  const dragHandle = async (toSeconds, { release = true } = {}) => {
    const h = await handle();
    await win.mouse.move(h.x, h.y);
    await win.mouse.down();
    const x1 = map.x(toSeconds);
    for (let i = 1; i <= 16; i++) {
      await win.mouse.move(h.x + ((x1 - h.x) * i) / 16, h.y);
      await win.waitForTimeout(45);
    }
    if (release) await win.mouse.up();
  };

  const s0 = await stats();
  check("the engine reports scrub stats (an audio output is open)", s0 != null, JSON.stringify(s0));

  // ---- The setting ----
  await openSettingsFromEditor(win);
  await settingsTab(win, "edit");
  check("the row is enabled", !(await win.locator("[data-testid=settings-row-scrubAudio]").getAttribute("data-disabled")));
  check("the toggle is off by default", (await toggle().getAttribute("aria-checked")) === "false");
  await shot("sa1-setting-off");
  await win.locator("[data-testid=settings-cancel]").click();
  await win.waitForTimeout(300);
  check("saved as off", (await prefsOf(win)).scrubAudio === false);

  // ---- Off: nothing plays ----
  await seek(win, map, 1);
  const base = await count();
  await dragHandle(5);
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("ArrowRight");
  await win.waitForTimeout(300);
  check("with it off, dragging and stepping play no snippets", (await count()) === base, `${base} -> ${await count()}`);

  // ---- On ----
  await openSettingsFromEditor(win);
  await settingsTab(win, "edit");
  await toggle().click();
  check("the toggle turns on", (await toggle().getAttribute("aria-checked")) === "true");
  await shot("sa2-setting-on");
  await saveSettings(win);
  check("saved as on", (await prefsOf(win)).scrubAudio === true);

  await seek(win, map, 1);
  const c0 = await count();
  await dragHandle(6, { release: false });
  const c1 = await count();
  const mid = await stats();
  check("a drag plays snippets as it goes", c1 - c0 >= 4, `${c0} -> ${c1}`);
  const t = await now(win);
  check("the latest one is at the playhead's position", Math.abs(mid.lastUs / 1e6 - t) < 0.6, `snippet ${(mid.lastUs / 1e6).toFixed(2)} s, playhead ${t} s`);
  check("a snippet of the clip's sound has level", Math.max(mid.left, mid.right) > 0.001, `${mid.left.toFixed(3)} / ${mid.right.toFixed(3)}`);
  await win.mouse.up();
  await win.waitForTimeout(400);
  const c2 = await count();
  await win.waitForTimeout(500);
  check("when the drag stops no more follow", (await count()) === c2, `${c2} -> ${await count()}`);

  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("ArrowLeft");
  await win.waitForTimeout(300);
  check("an arrow step plays a snippet", (await count()) === c2 + 1, `${c2} -> ${await count()}`);
  await seek(win, map, 3);
  const afterClick = await count();
  await win.mouse.click(map.x(4), map.y);
  await win.waitForTimeout(300);
  check("a click on the ruler plays one", (await count()) > afterClick);

  // ---- Preview axis, with the setting off ----
  await win.evaluate((p) => window[btoa("setPreferences")](p), { scrubAudio: false });
  await win.waitForTimeout(400);
  await seek(win, map, 2);
  const y = map.y + 80;
  await button(win, "Preview axis").click();
  const a0 = await count();
  for (let i = 0; i < 12; i++) {
    await win.mouse.move(map.x(2.5 + i * 0.2), y);
    await win.waitForTimeout(50);
  }
  check("Preview video only: skimming plays no snippets", (await count()) === a0, `${a0} -> ${await count()}`);
  await win.locator("[data-testid=tool-previewaxis-menu]").click();
  await win.waitForTimeout(250);
  check("Preview video and audio is enabled", !(await win.locator("[data-testid=axis-audio]").getAttribute("data-disabled")));
  await shot("sa3-axis-menu");
  await win.locator("[data-testid=axis-audio]").click();
  await win.waitForTimeout(250);
  const b0 = await count();
  for (let i = 0; i < 12; i++) {
    await win.mouse.move(map.x(2.5 + i * 0.2), y);
    await win.waitForTimeout(50);
  }
  const b1 = await count();
  check("Preview video and audio: skimming plays snippets (the setting is off)", b1 - b0 >= 4, `${b0} -> ${b1}`);
  check("the playhead stayed", Math.abs((await now(win)) - 2) < 0.05);
  await win.mouse.move(map.x(2), 120, { steps: 4 });
  await win.waitForTimeout(400);
  const b2 = await count();
  await win.waitForTimeout(400);
  check("leaving the timeline stops them", (await count()) === b2);

  // Back to video only, and the toggle off.
  await win.locator("[data-testid=tool-previewaxis-menu]").click();
  await win.locator("[data-testid=axis-video]").click();
  await win.waitForTimeout(250);
  const d0 = await count();
  for (let i = 0; i < 8; i++) {
    await win.mouse.move(map.x(3 + i * 0.2), y);
    await win.waitForTimeout(50);
  }
  check("back to video only: none again", (await count()) === d0);
  await button(win, "Preview axis").click();
  return report();
};
