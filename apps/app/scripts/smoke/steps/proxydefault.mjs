// Settings › Performance › Proxy is the default of a project's Proxy switch (after `import`;
// run the session with AUTO_PROXY=1, which lifts the test profile's "no automatic proxies"
// override): a project with no choice of its own is Turned on in Details and Project settings;
// unchecking the Settings box and saving turns it Turned off there (and nothing is made for
// a new import); the project's own choice, once made, is kept when the default changes back.
import { checks } from "./_anim.mjs";
import { openSettingsFromEditor, settingsTab, prefsOf } from "./_settings.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const details = async () => {
    await win.keyboard.press("Escape");
    await win.locator("[data-testid=project-tab-details]").click().catch(() => {});
    await win.waitForTimeout(400);
    return (await win.locator("[data-testid=inspector-project]").innerText()).replace(/\s+/g, " ");
  };
  check("the preference is on by default", (await prefsOf(win)).proxyDefault === true);
  check("a project with no choice of its own has Proxy turned on", /Proxy: Turned on/.test(await details()));
  await openSettingsFromEditor(win);
  await settingsTab(win, "performance");
  const box = win.locator("[data-testid=settings-proxy]");
  check("the Settings checkbox is checked", (await box.getAttribute("aria-checked")) === "true");
  await shot("pd1-settings");
  await box.click();
  await win.locator("[data-testid=settings-save]").click();
  await win.waitForSelector("[data-testid=settings-window]", { state: "detached", timeout: 10000 });
  await win.waitForTimeout(600);
  check("unchecked and saved, the default is off", (await prefsOf(win)).proxyDefault === false);
  check("and the project (no choice of its own) shows Turned off", /Proxy: Turned off/.test(await details()));
  return report();
};
