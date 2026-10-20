// Arrange layers after `arrangelayers reopen`: the project that was made with it off comes back
// off (Details "Turned off", its tracks still in bands, the file says false); Project settings
// shows the switch live with CapCut's note "*Cannot be turned off after turned on"; Cancel leaves
// it off; turning it on and Save leaves the tracks where they were, writes true, and the switch
// then can't be turned off again (disabled). The preference is put back on.
// Shots: `alc1-dialog-off`, `alc2-dialog-on` ↔ `17-inspector-project/001`.
import { checks, savedProject } from "./_anim.mjs";
import { rulerMap } from "./_preview.mjs";
import { openSettingsFromEditor, settingsTab, saveSettings, prefsOf } from "./_settings.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const dialog = win.locator("[data-testid=project-settings]");
  const doc = () => savedProject(win, udDir);
  const types = async () => (await doc()).timeline.tracks.map((t) => t.type);
  const details = async () => {
    await win.mouse.click(ctx.map.x(0.5), ctx.map.y);
    await win.waitForTimeout(400);
    await win.locator("[data-testid=project-tab-details]").click();
    await win.waitForTimeout(300);
    return (await win.locator("[data-testid=inspector-project]").innerText()).replace(/\s+/g, " ");
  };
  const open = async () => {
    await details();
    await win.locator("[data-testid=project-modify]").click();
    await dialog.waitFor({ timeout: 5000 });
    await win.waitForTimeout(500);
  };
  const toggle = win.locator("[data-testid=ps-arrange-layers]");

  check("the file still says Arrange layers off", (await doc()).settings.arrangeLayers === false);
  check("its tracks are still in bands (text, sticker, effect, video)", (await types()).join() === "text,sticker,filter,media", (await types()).join());
  check("Details says Turned off", /Arrange layers:\s*Turned off/.test(await details()));
  await open();
  await shot("alc1-dialog-off");
  check("Project settings shows the switch off and live", (await toggle.getAttribute("aria-checked")) === "false" && (await toggle.isDisabled()) === false);
  check("with CapCut's note", /\*Cannot be turned off after turned on/.test(await dialog.innerText()));
  await toggle.click();
  await win.locator("[data-testid=ps-cancel]").click();
  await dialog.waitFor({ state: "hidden" });
  await win.waitForTimeout(800);
  check("Cancel leaves it off", (await doc()).settings.arrangeLayers === false);
  await open();
  await toggle.click();
  check("the switch shows on before Save", (await toggle.getAttribute("aria-checked")) === "true");
  await win.locator("[data-testid=ps-save]").click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await win.waitForTimeout(2500);
  check("Save writes it on and leaves the tracks where they were", (await doc()).settings.arrangeLayers === true && (await types()).join() === "text,sticker,filter,media", (await types()).join());
  check("Details says Turned on", /Arrange layers:\s*Turned on/.test(await details()));
  await open();
  await shot("alc2-dialog-on");
  check("the switch is on and disabled: it can't be turned off", (await toggle.getAttribute("aria-checked")) === "true" && (await toggle.isDisabled()));
  await win.locator("[data-testid=ps-cancel]").click();
  await dialog.waitFor({ state: "hidden" });

  // Put the preference back.
  await openSettingsFromEditor(win);
  await settingsTab(win, "edit");
  await win.locator("[data-testid=settings-arrange-layers]").click();
  await saveSettings(win);
  check("the preference is back on", (await prefsOf(win)).arrangeLayers === true);
  return report();
};
