// The Voiceover panel from the timeline toolbar's microphone (after `import timeline`; run with
// OPENRIP_FAKE_MIC=1, so the engine records its stand-in microphone, a 440 Hz tone at a quarter
// of full scale, and nothing real is recorded; and OPENRIP_ENGINE_MUTE=1):
// - the microphone opens the panel: 00:00:00, "Recording not started", "Microphone connected";
// - Record counts 3, 2, 1, then records while the timeline plays from the playhead: the meter
//   lit by the tone (−12 dBFS), the time counting;
// - Stop puts the take on a new audio track at the playhead it started from, selected, saved,
//   one undo step; an export has the tone there; the left panel's Voiceovers lists it;
// - with Mute project checked the engine has the project muted while it records; Discard
//   throws the take away (no clip, no file), and so does closing the panel mid-take.
import { now, rulerMap, seek } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { press, state } from "./_undo.mjs";
import { band, exporter, pcm, side } from "./_audio.mjs";

const panel = (win) => win.locator("[data-testid=voiceover-panel]");
const text = (win, id) => win.locator(`[data-testid=voiceover-${id}]`).innerText();
const status = (win) => win.evaluate(() => window[btoa("voiceoverStatus")]());
const takes = (win, folder) => win.evaluate((folder) => window[btoa("voiceoverList")](folder), folder);

/** Wait (up to `s` seconds) until the panel's status reads `re`; its text. */
const until = async (win, re, s = 8) => {
  let t = "";
  for (let i = 0; i < s * 10; i++) {
    t = await text(win, "status").catch(() => "");
    if (re.test(t)) return t;
    await win.waitForTimeout(100);
  }
  return t;
};

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const before = await savedProject(win, ctx.udDir);
  const fps = before.settings?.fps || 24;
  await seek(win, ctx.map, 2);

  // ---- the panel ----
  await win.locator("[data-testid=tool-voiceover]").click();
  await win.waitForTimeout(600);
  check("the microphone opens the Voiceover panel", await panel(win).isVisible());
  check(`it starts at ${await text(win, "time")}, "${await text(win, "status")}"`, (await text(win, "time")) === "00:00:00" && (await text(win, "status")) === "Recording not started");
  check(`the permission line: "${await text(win, "permission")}"`, (await text(win, "permission")) === "Microphone connected");
  await shot("vo-1-panel");

  // ---- a take ----
  await win.locator("[data-testid=voiceover-record]").click();
  const counting = await until(win, /Recording in [123]/, 2);
  check(`Record counts down first ("${counting}")`, /Recording in [123]…/.test(counting));
  check("recording starts after the count", /^Recording…$/.test(await until(win, /^Recording…$/, 5)));
  const recordedFrom = Date.now();
  const t0 = await now(win);
  await win.waitForTimeout(2200);
  const lit = +(await win.locator("[data-testid=voiceover-meter]").getAttribute("data-lit"));
  check(`the meter shows the tone's level (${lit} of 52 bars lit; −12 dBFS is 42)`, Math.abs(lit - 42) <= 3);
  check(`the time counts (${await text(win, "time")})`, /^00:00:0[2-3]$/.test(await text(win, "time")));
  const t1 = await now(win);
  check(`the timeline plays while it records (${t0.toFixed(2)} s → ${t1.toFixed(2)} s)`, t1 - t0 > 1.5);
  const live = await status(win);
  check("the engine is recording, the project not muted", live.recording && !live.projectMuted, JSON.stringify(live));
  await shot("vo-2-recording");
  const s0 = await state(ctx);
  await win.locator("[data-testid=voiceover-record]").click();
  const recorded = (Date.now() - recordedFrom) / 1000;
  const saved = await until(win, /added to the timeline|couldn't/);
  check(`Stop keeps the take ("${saved}")`, /^Voiceover 1 added to the timeline$/.test(saved));
  await win.waitForTimeout(1500);
  const doc = await savedProject(win, ctx.udDir);
  const take = doc.timeline.clips.find((c) => c.type === "audio" && /\/voiceover\/Voiceover%201\.wav$|\/voiceover\/Voiceover 1\.wav$/.test(doc.assets[c.assetId]?.path ?? ""));
  const start = take ? +take.startTick / 1e6 : NaN;
  const length = take ? (+take.endTick - +take.startTick) / 1e6 : NaN;
  check(
    `on a new audio track at the playhead it started from (${start.toFixed(3)} s, ${length.toFixed(2)} s long, recorded for ${recorded.toFixed(2)} s)`,
    !!take && Math.abs(start - 2) < 1.5 / fps && Math.abs(length - recorded) < 0.6 && doc.timeline.tracks.length === before.timeline.tracks.length + 1,
  );
  // The project's media folder, from where the take was written: …/media/<folder>/voiceover/.
  const folder = decodeURIComponent(doc.assets[take.assetId].path).split("/").at(-3);
  ctx.voiceoverFolder = folder;
  const tabs = await win.locator("[data-testid=inspector] [role=tab]").allInnerTexts();
  check(`the take is selected (inspector tabs ${tabs.join(", ")})`, tabs.slice(0, 3).join(",") === "Basic,Voice changer,Speed");
  // Placing the take is one step.
  const s1 = await state(ctx);
  await press(win, "Meta+z");
  const s2 = await state(ctx, Date.now() - 400);
  await press(win, "Meta+Shift+z");
  const s3 = await state(ctx, Date.now() - 400);
  check("⌘Z takes the placed take off, ⇧⌘Z puts it back", s2.doc === s0.doc && s3.doc === s1.doc);
  await shot("vo-3-placed");
  const exportAs = await exporter(ctx);
  const x = side(pcm(await exportAs("vo-take"), start + 0.3, 1), 0);
  const tone = band(x, 430, 450) / Math.max(1e-12, band(x, 600, 620));
  check(`the export has the take's 440 Hz tone where it sits (×${tone.toFixed(0)} against 610 Hz)`, tone > 20);

  // ---- Mute project, Discard, close ----
  const n = (await takes(win, folder)).length;
  check(`the take is in the project's voiceover folder (${n})`, n === 1);
  if (!(await panel(win).isVisible())) await win.locator("[data-testid=tool-voiceover]").click();
  await panel(win).locator('[role=checkbox][aria-label="Mute project"]').click();
  await win.locator("[data-testid=voiceover-record]").click();
  await until(win, /^Recording…$/, 6);
  const muted = await status(win);
  check("Mute project: the project is muted while it records", muted.recording && muted.projectMuted, JSON.stringify(muted));
  await win.waitForTimeout(800);
  await win.locator("[data-testid=voiceover-discard]").click();
  await win.waitForTimeout(800);
  const after = await status(win);
  const clips = (await savedProject(win, ctx.udDir)).timeline.clips.filter((c) => c.type === "audio").length;
  check(`Discard: not recording, unmuted, no new take or clip (${(await takes(win, folder)).length} takes)`, !after.recording && !after.projectMuted && (await takes(win, folder)).length === n && clips === 1);
  await win.locator("[data-testid=voiceover-record]").click();
  await until(win, /^Recording…$/, 6);
  await win.locator("[data-testid=voiceover-close]").click();
  await win.waitForTimeout(800);
  check("closing the panel mid-take throws it away", !(await panel(win).isVisible()) && !(await status(win)).recording && (await takes(win, folder)).length === n);

  // ---- the left panel's Voiceovers ----
  await win.locator("[data-testid=assets-tab-audio]").click();
  await win.locator("[data-testid=assets-section-voiceovers]").click();
  await win.waitForTimeout(1500);
  const rows = await win.locator("[data-testid=audio-section-voiceovers] [data-testid=audio-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
  check(`Voiceovers lists the take (${rows.join(", ")})`, rows.join(",") === "Voiceover 1");
  await shot("vo-4-voiceovers");
  return report();
};
