// The Voiceover panel's input device menu, Volume, Echo reduction and Mute project (after `import
// timeline` of a small clip; run with OPENRIP_FAKE_MIC=1 OPENRIP_ENGINE_MUTE=1: the page's test
// microphones are two tones, 440 Hz and 880 Hz at a quarter of full scale):
// - the device menu lists the system default and both microphones, ticks the one in use;
// - with the second microphone and Volume 50 a take is an 880 Hz tone at half the level (the WAV
//   is read back), the meter live at -18 dBFS while it records;
// - the device, volume, Echo reduction and Mute project are remembered across a restart.
import fs from "node:fs";
import { checks, savedProject } from "./_anim.mjs";
import { openEditor } from "./_preview.mjs";

const panel = (win) => win.locator("[data-testid=voiceover-panel]");
const status = (win) => win.locator("[data-testid=voiceover-status]").innerText();
const device = (win) => win.locator("[data-testid=voiceover-device]").innerText();
const volume = (win) => panel(win).locator("[data-testid=voiceover-volume] input").inputValue();
const checked = async (win, label) => (await panel(win).locator(`[role=checkbox][aria-label="${label}"]`).getAttribute("aria-checked")) === "true";

/** A mono 16-bit WAV's peak (0..1) and its frequency (from the zero crossings). */
const analyse = (file) => {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24);
  const n = (b.length - 44) / 2;
  let peak = 0;
  let crossings = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const v = b.readInt16LE(44 + i * 2);
    peak = Math.max(peak, Math.abs(v));
    if (last < 0 && v >= 0) crossings++;
    last = v;
  }
  return { peak: peak / 32767, hz: crossings / (n / rate), seconds: n / rate };
};

export default async (ctx) => {
  let { win } = ctx;
  const { shot } = ctx;
  const { check, report } = checks();

  await win.locator("[data-testid=tool-voiceover]").click();
  await win.waitForTimeout(800);
  check(`the input device starts on "${await device(win)}"`, (await device(win)) === "System default microphone");
  await win.locator("[data-testid=voiceover-device]").click();
  const rows = await win.locator("[data-testid=voiceover-device-option]").allInnerTexts();
  check(`the menu lists the microphones (${rows.join(", ")})`, rows.join(",") === "System default microphone,Test microphone,Second test microphone");
  const ticked = await win.locator("[data-testid=voiceover-device-option][aria-selected=true]").allInnerTexts();
  check(`the one in use is ticked (${ticked.join(", ")})`, ticked.join() === "System default microphone");
  await shot("vopt-1-menu");
  await win.locator("[data-testid=voiceover-device-option]", { hasText: "Second test microphone" }).click();
  check(`picking one shows it ("${await device(win)}")`, (await device(win)) === "Second test microphone");

  // ---- volume, echo reduction, mute ----
  const field = panel(win).locator("[data-testid=voiceover-volume] input");
  check(`Volume starts at ${await volume(win)}`, (await volume(win)) === "100");
  await field.fill("50");
  await field.press("Enter");
  await win.waitForTimeout(300);
  check(`Volume takes 50 (${await volume(win)})`, (await volume(win)) === "50");
  check("Echo reduction and Mute project start off", !(await checked(win, "Echo reduction")) && !(await checked(win, "Mute project")));
  await panel(win).locator('[role=checkbox][aria-label="Echo reduction"]').click();
  await panel(win).locator('[role=checkbox][aria-label="Mute project"]').click();
  check("both can be ticked", (await checked(win, "Echo reduction")) && (await checked(win, "Mute project")));

  // ---- a take ----
  await win.locator("[data-testid=voiceover-record]").click();
  for (let i = 0; i < 80 && (await status(win)) !== "Recording…"; i++) await win.waitForTimeout(100);
  await win.waitForTimeout(2000);
  const lit = +(await win.locator("[data-testid=voiceover-meter]").getAttribute("data-lit"));
  check(`the meter shows -18 dBFS (${lit} of 52 bars lit; 36 expected)`, Math.abs(lit - 36) <= 3);
  const live = await win.evaluate(() => window[btoa("voiceoverStatus")]());
  check("the project is muted while it records", live.recording && live.projectMuted, JSON.stringify(live));
  await shot("vopt-2-recording");
  await win.locator("[data-testid=voiceover-record]").click();
  for (let i = 0; i < 100 && !/added to the timeline/.test(await status(win)); i++) await win.waitForTimeout(200);
  const doc = await savedProject(win, ctx.udDir);
  const clip = doc.timeline.clips.find((c) => c.type === "audio");
  const file = decodeURIComponent(new URL(doc.assets[clip.assetId].path).pathname);
  const a = analyse(file);
  check(`the take is the second microphone's 880 Hz (${a.hz.toFixed(0)} Hz)`, Math.abs(a.hz - 880) < 15);
  check(`at half the volume (peak ${a.peak.toFixed(3)}; 0.125 expected)`, Math.abs(a.peak - 0.125) < 0.01);
  check(`and about as long as it recorded (${a.seconds.toFixed(2)} s)`, a.seconds > 1.5 && a.seconds < 3.5);
  const after = await win.evaluate(() => window[btoa("voiceoverStatus")]());
  check("the sound is back when it stops", !after.recording && !after.projectMuted);

  // ---- remembered ----
  await win.waitForTimeout(1500);
  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await win.locator("[data-testid=tool-voiceover]").click();
  await win.waitForTimeout(1000);
  check(`the device, volume and ticks are remembered ("${await device(win)}", ${await volume(win)})`, (await device(win)) === "Second test microphone" && (await volume(win)) === "50" && (await checked(win, "Echo reduction")) && (await checked(win, "Mute project")));
  await shot("vopt-3-remembered");
  return report();
};
