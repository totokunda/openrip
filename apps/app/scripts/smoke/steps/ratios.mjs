// The player's Ratio menu (after `import timeline`; CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1,
// built app): CapCut's list in its order (Original, Custom, 16:9, 4:3, 2.35:1, 2:1, 1.85:1, 9:16,
// 3:4, 5.8-inch, 1:1); 2.35:1 and 5.8-inch picked (the canvas shown in the project's Details, the
// ratio saved in the project), Original following the clip, a tick on the current one, and the
// choice still there after the app is restarted.
// Shot: `ra1-menu` ↔ `16-player/006-aspect-ratio-menu`.
import { checks, savedProject } from "./_anim.mjs";
import { openEditor } from "./_preview.mjs";

export default async (ctx) => {
  let { win } = ctx;
  const { shot, udDir } = ctx;
  const { check, report } = checks();
  const savedRatio = async () => (await savedProject(win, udDir)).settings?.aspectRatio;
  const open = async () => {
    await win.locator("[data-testid=ratio-menu]").click();
    await win.waitForTimeout(300);
  };
  const items = () => win.locator("[role=menuitem]").evaluateAll((els) => els.map((e) => e.innerText.trim().replace(/\s+/g, " ")));
  const canvas = async () => {
    await win.keyboard.press("Escape");
    await win.locator("[data-testid=inspector-project]").waitFor({ timeout: 3000 }).catch(() => {});
    return (await win.locator("[data-testid=inspector-project]").innerText().catch(() => "")).match(/Canvas:\s*(\d+) × (\d+)/)?.slice(1).map(Number);
  };

  await open();
  const list = await items();
  check("the menu lists CapCut's ratios in its order", list.join("|") === "Original|Custom|16:9|4:3|2.35:1|2:1|1.85:1|9:16|3:4|5.8-inch|1:1", list.join("|"));
  await shot("ra1-menu");
  await win.locator("[data-testid='ratio-2.35:1']").click();
  await win.waitForTimeout(1500);
  let r = await savedRatio();
  check("2.35:1 is saved in the project", r?.id === "2.35:1" && Math.abs(r.width / r.height - 2.35) < 0.01, JSON.stringify(r));
  let size = await canvas();
  check("the canvas follows (Details: 1920 wide, about 817 high)", size && size[0] === 1920 && Math.abs(size[1] - 817) <= 2, JSON.stringify(size));
  await open();
  check("the current ratio carries the tick", (await win.locator("[data-testid='ratio-2.35:1'] svg").count()) === 1);
  await win.locator("[data-testid='ratio-5.8-inch']").click();
  await win.waitForTimeout(1500);
  r = await savedRatio();
  size = await canvas();
  check("5.8-inch is a tall phone screen, saved", r?.id === "5.8-inch" && r.height > r.width && size[1] > size[0], JSON.stringify([r, size]));
  await open();
  await win.locator("[data-testid=ratio-original]").click();
  await win.waitForTimeout(1500);
  r = await savedRatio();
  check("Original follows the first clip (9:16 for this portrait one)", r?.id === "original" && Math.abs(r.width / r.height - 9 / 16) < 0.02, JSON.stringify(r));
  await open();
  await win.locator("[data-testid='ratio-1:1']").click();
  await win.waitForTimeout(1500);
  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await win.waitForTimeout(1500);
  r = await savedRatio();
  size = await canvas();
  check("1:1 survives a restart, the canvas square", r?.id === "1:1" && size && size[0] === size[1], JSON.stringify([r, size]));
  return report();
};
