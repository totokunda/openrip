// After `projectsettings reopen` with PS_KEEP=1: the project's settings come back from its file:
// the name, 30 fps, 9:16 at the custom 720×1280, the filter clip length, in the file, in the
// inspector's Details, in the dialog, and in the engine's canvas.
import { rulerMap } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  const d = await savedProject(win, udDir);
  check("the file keeps the name, 30 fps, 9:16, the custom 720×1280 and the filter clip length", d.meta.name === "PS Renamed" && d.settings.fps === 30 && d.settings.aspectRatio?.id === "9:16" && d.settings.engineCanvas?.width === 720 && d.settings.engineCanvas?.height === 1280 && d.settings.defaultClipLength === 10, JSON.stringify([d.meta.name, d.settings.fps, d.settings.aspectRatio, d.settings.engineCanvas, d.settings.defaultClipLength]));
  await win.mouse.click(map.x(0.5), map.y);
  await win.waitForTimeout(400);
  await win.locator("[data-testid=project-tab-details]").click();
  await win.waitForTimeout(500);
  const text = (await win.locator("[data-testid=inspector-project]").innerText()).replace(/\s+/g, " ");
  check("Details shows them and the engine's canvas", /Frame rate: 30\.00fps/.test(text) && /Aspect ratio: 9:16/.test(text) && /Resolution: 720 × 1280/.test(text) && /Canvas: 720 × 1280/.test(text), text.slice(-120));
  await win.locator("[data-testid=project-modify]").click();
  await win.waitForTimeout(600);
  const dlg = (await win.locator("[data-testid=project-settings]").innerText()).replace(/\s+/g, " ");
  check("the dialog opens on them", /30\.00 fps/.test(dlg) && /9:16/.test(dlg) && /Custom/.test(dlg) && (await win.locator("[data-testid=ps-width]").inputValue()) === "720", dlg.slice(0, 100));
  await shot("ps09-reopened-dialog");
  await win.keyboard.press("Escape");
  return report();
};
