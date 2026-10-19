// The timeline keys CapCut has that were missing (after `import timeline`; run on
// ~/Downloads/IMG_9079.MOV with CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1), and the editor's
// "Auto saved" status (docs/plan/capcut-ui-spec.md §6.3, §6.4):
//   J / K / L   L plays (the player's time moves at 1×), L again at 2× and 4×, K stops, J runs
//               backward, J again faster, K stops; a held key counts once
//   ⌥M          a marker at the playhead in the next colour of the cycle (a second one the next)
//   ⇧⌥K         keys at the playhead on the selected clip (place, size, turn, opacity), saved
//   ⌘ + scroll  zooms the timeline (up in), not the page
//   Auto saved  the top bar's "Auto saved: hh:mm:ss" appears after a change and follows the save
//   Shortcuts   Settings ▸ Shortcuts lists each of them with its key
import { rulerMap, seek } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { doc, fpsOf, key } from "./_timeline.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const time = async () => +(await win.locator("[data-testid=player-time]").getAttribute("data-time"));
  const total = +(await win.locator("[data-testid=player-time]").getAttribute("data-total"));
  const rate = async (ms) => {
    const a = await time();
    await win.waitForTimeout(ms);
    return ((await time()) - a) / (ms / 1000);
  };
  const press = async (k) => {
    await win.evaluate(() => document.activeElement?.blur?.());
    await win.keyboard.press(k);
  };

  // J / K / L
  await seek(win, map, 1);
  const t0 = await time();
  await press("l");
  await win.waitForTimeout(400);
  const r1 = await rate(1000);
  check("L plays forward at about 1×", r1 > 0.6 && r1 < 1.5, `${r1.toFixed(2)}×`);
  await press("l");
  await win.waitForTimeout(300);
  const r2 = await rate(800);
  check("L again plays at about 2×", r2 > 1.4 && r2 < 2.8, `${r2.toFixed(2)}×`);
  await press("l");
  await win.waitForTimeout(300);
  const r4 = await rate(800);
  check("and again at about 4×", r4 > 3 && r4 < 5.5, `${r4.toFixed(2)}×`);
  await press("k");
  await win.waitForTimeout(400);
  const stopped = await rate(600);
  check("K stops", Math.abs(stopped) < 0.05, `${stopped.toFixed(2)}×`);
  const reached = await time();
  check("the playhead moved on from where L started", reached > t0 + 2, `${t0.toFixed(2)} → ${reached.toFixed(2)} s`);
  await press("j");
  await win.waitForTimeout(300);
  const b1 = await rate(800);
  check("J runs backward at about 1×", b1 < -0.6 && b1 > -1.6, `${b1.toFixed(2)}×`);
  await press("j");
  await win.waitForTimeout(300);
  const b2 = await rate(800);
  check("J again is faster", b2 < -1.4 && b2 > -2.8, `${b2.toFixed(2)}×`);
  await press("l");
  await win.waitForTimeout(300);
  const slower = await rate(800);
  check("L while running backward slows it", slower > -1.6 && slower < -0.4, `${slower.toFixed(2)}×`);
  await press("k");
  await shot("s1-shuttle-stopped");
  await seek(win, map, 0.5);
  await press("j");
  await win.waitForTimeout(800);
  check("J at the start doesn't run", Math.abs(await time()) < 0.6 && Math.abs(await rate(400)) < 0.05);
  // Space after L stops it too.
  await press("l");
  await win.waitForTimeout(600);
  await press("l");
  await win.waitForTimeout(400);
  await press("Space");
  await win.waitForTimeout(300);
  check("Space stops a faster run", Math.abs(await rate(500)) < 0.05);
  check("(held L: autorepeat counts once)", total > 0);

  // ⌥M
  const fps = fpsOf(await doc(ctx));
  await seek(win, map, 2);
  await press("Alt+m");
  await seek(win, map, 4);
  await press("Alt+m");
  await seek(win, map, 6);
  await press("m");
  let ms = (await doc(ctx)).timeline.markers ?? [];
  const COLORS = ["#AE81CE", "#EB7A6B", "#E49F54", "#A8C06B", "#57BECB"];
  check(
    "⌥M adds markers in the next colour of the cycle (M still the first colour)",
    ms.length === 3 && ms[0].frame === 2 * fps && ms[0].color.toUpperCase() === COLORS[1] && ms[1].color.toUpperCase() === COLORS[2] && ms[2].color.toUpperCase() === COLORS[0],
    JSON.stringify(ms.map((m) => [m.frame, m.color])),
  );
  await seek(win, map, 2);
  await press("Alt+m");
  ms = (await doc(ctx)).timeline.markers ?? [];
  check("⌥M on a marker changes its colour", ms.length === 3 && ms[0].color.toUpperCase() === COLORS[2], ms[0].color);

  // ⇧⌥K
  await seek(win, map, 1);
  await press("Meta+a");
  await win.waitForTimeout(300);
  await press("Alt+Shift+k");
  await win.waitForTimeout(500);
  const d = await doc(ctx);
  const keyed = d.timeline.clips.filter((c) => c.keyframes && Object.keys(c.keyframes).length);
  const names = keyed.length ? Object.keys(keyed[0].keyframes) : [];
  check("⇧⌥K keys the selected clip at the playhead (place, size, turn, opacity)", keyed.length >= 1 && ["position", "scale", "rotation", "opacity"].every((p) => names.includes(p)), JSON.stringify(names));
  await press("Meta+z");
  await win.waitForTimeout(500);
  const back = (await doc(ctx)).timeline.clips.filter((c) => c.keyframes && Object.keys(c.keyframes).length);
  check("⌘Z takes the keys back", back.length === 0, `${back.length} keyed clips`);

  // ⌘ + scroll
  await win.mouse.move(map.x(3), map.y + 80);
  const pps0 = (await rulerMap(win)).pps;
  await win.keyboard.down("Meta");
  for (let i = 0; i < 8; i++) await win.mouse.wheel(0, -60);
  await win.keyboard.up("Meta");
  await win.waitForTimeout(600);
  const pps1 = (await rulerMap(win)).pps;
  check("⌘ + scroll up zooms the timeline in", pps1 > pps0 * 1.2, `${pps0.toFixed(1)} → ${pps1.toFixed(1)} px/s`);
  await win.keyboard.down("Meta");
  for (let i = 0; i < 20; i++) await win.mouse.wheel(0, 60);
  await win.keyboard.up("Meta");
  await win.waitForTimeout(600);
  const pps2 = (await rulerMap(win)).pps;
  check("and down zooms out", pps2 < pps1 * 0.8, `${pps1.toFixed(1)} → ${pps2.toFixed(1)} px/s`);
  check("not the page", (await win.evaluate(() => devicePixelRatio)) > 0 && (await win.evaluate(() => visualViewport.scale)) === 1);

  // Auto saved
  const status = win.locator("[data-testid=autosave]");
  check("the top bar shows 'Auto saved: hh:mm:ss' after the saves", /^Auto saved: \d\d:\d\d:\d\d$/.test((await status.innerText().catch(() => "")).trim()), await status.innerText().catch(() => "none"));
  const first = await status.innerText();
  await win.waitForTimeout(2100);
  await seek(win, map, 3);
  await press("m");
  await win.waitForTimeout(2500);
  const second = await status.innerText();
  check("it moves on when the project is saved again", second !== first, `${first} → ${second}`);
  await shot("s2-autosave");

  // Settings ▸ Shortcuts lists them.
  await win.locator("[data-testid=shortcuts]").click();
  await win.waitForTimeout(800);
  const text = await win.locator("body").innerText();
  const rows = ["Shuttle left", "Shuttle stop", "Shuttle right", "Add marker with new color", "Add keyframe", "Zoom in/Zoom out"];
  check("the Shortcuts window lists the new rows", rows.every((r) => text.includes(r)), rows.filter((r) => !text.includes(r)).join(", "));
  await shot("s3-shortcuts");
  await win.keyboard.press("Escape");
  return report();
};
