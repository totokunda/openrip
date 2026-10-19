// Record when the system refuses (run with OPENRIP_FAKE_CAPTURE=denied: the main process answers
// as macOS does for refused permissions; nothing is captured or asked): the panel says that
// Screen Recording is off and where to turn it on, and Record is off; for the camera Record
// says the camera is off instead of crashing; the microphone's refusal is explained too.
import { checks } from "./_anim.mjs";

export default async ({ win, shot }) => {
  const { check, report } = checks();
  await win.locator("[data-testid=media-record]").click();
  await win.waitForTimeout(1000);
  const line = win.locator("[data-testid=record-permission]");
  const text = await line.innerText();
  check(`the screen refusal is explained ("${text}")`, (await line.getAttribute("data-refused")) === "true" && /Screen recording is off.*System Settings/.test(text));
  check("Record is off", await win.locator("[data-testid=record-start]").isDisabled());
  await shot("recd-1-screen");

  await win.locator("[data-testid=record-mode-camera]").click();
  await win.waitForTimeout(600);
  check("the camera mode has no screen warning and Record is on", (await line.count()) === 0 && !(await win.locator("[data-testid=record-start]").isDisabled()));
  await win.locator("[data-testid=record-start]").click();
  for (let i = 0; i < 60 && (await win.locator("[data-testid=record-status]").getAttribute("data-error")) !== "true"; i++) await win.waitForTimeout(100);
  const status = await win.locator("[data-testid=record-status]").innerText();
  check(`the camera refusal is explained ("${status}")`, /Camera access is off.*System Settings/.test(status));
  check("the panel is still usable (not recording)", !(await win.locator("[data-testid=record-discard]").count()));
  await shot("recd-2-camera");

  await win.locator("[data-testid=record-close]").click();
  await win.locator("[data-testid=tool-voiceover]").click();
  await win.waitForTimeout(800);
  const vo = await win.locator("[data-testid=voiceover-permission]").innerText();
  check(`the Voiceover panel explains the microphone refusal ("${vo}")`, /Microphone access is off/.test(vo) && (await win.locator("[data-testid=voiceover-record]").isDisabled()));
  return report();
};
