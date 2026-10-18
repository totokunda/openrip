// The Voiceover panel when the microphone is refused (run with OPENRIP_FAKE_MIC=denied: the
// main process answers as macOS does for a refused permission; nothing is recorded or asked):
// the panel says so and where to turn it on, and Record is off.
import { checks } from "./_anim.mjs";

export default async ({ win, shot }) => {
  const { check, report } = checks();
  await win.locator("[data-testid=tool-voiceover]").click();
  await win.waitForTimeout(800);
  const line = win.locator("[data-testid=voiceover-permission]");
  const text = await line.innerText();
  check(`the refusal is explained ("${text}")`, (await line.getAttribute("data-refused")) === "true" && /Microphone access is off.*System Settings/.test(text));
  check("Record is off", await win.locator("[data-testid=voiceover-record]").isDisabled());
  const status = await win.evaluate(() => window[btoa("voiceoverStatus")]());
  check(`the engine records nothing (${JSON.stringify(status)})`, status.permission === "denied" && !status.recording);
  await shot("vod-1-denied");
  return report();
};
