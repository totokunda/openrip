// The inspector's Audio tab through its own controls, on the first video (after `import
// timeline` on a clip with sound: ~/Downloads/IMG_9079.MOV with CLIP_NAME=IMG_9079; run with
// OPENRIP_ENGINE_MUTE=1). Each control changes the saved clip, is one undo step (undoCase), and
// changes what the engine mixes, read back from exports with ffmpeg:
// - Basic: Volume typed to −6 dB (the export 6 dB down) and Fade in 1 s (its start silent); ↺.
// - Volume keyframes: the diamond keys 0 dB at 1 s, −20 dB typed at 4 s keys there (CapCut's
//   edit-at-the-playhead), the field shows each key's value at its time; the export 20 dB down
//   by 4 s.
// - Normalize loudness: the checkbox measures with the engine and shows the gain; the export at
//   the level that gain gives.
// - Fill channel: the checkbox, then "Fill left with right" from its menu: both channels alike.
// - Voice changer: the Telephone tile (lows and highs cut), its sliders, Strength 0 (the clip as
//   it was), search and the group chips, None.
// Leaves Normalize on, Fill left with right and Telephone at strength 0 for `audiouicheck`
// after `reopen`.
import { seek, settled, tab } from "./_preview.mjs";
import { checks, clipsWhere, focus, savedProject } from "./_anim.mjs";
import { field, typeInto, undoCase } from "./_undo.mjs";
import { channelDifference, dbOf, exporter, integrated, pcm, residual, rms, side, spectralShape } from "./_audio.mjs";

const inspector = (win) => win.locator("[data-testid=inspector]");

/** The clip as saved now. */
const savedClip = async (ctx, id) => (await savedProject(ctx.win, ctx.udDir)).timeline.clips.find((c) => c.clipId === id);

/** Open a sub-tab of the Audio tab (Basic, Voice changer). */
export const audioSub = async (win, name) => {
  await inspector(win).locator("[role=tab]", { hasText: new RegExp(`^${name}$`) }).first().click();
  await win.waitForTimeout(400);
};

/** Pick an option of the Fill channel menu. */
export const chooseFill = async (win, name) => {
  await win.locator("[data-testid=fill-channel]").click();
  await win.waitForTimeout(300);
  await settled(win, () => win.getByRole("option", { name, exact: true }).click());
};

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const doc = await savedProject(win, ctx.udDir);
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  if (!video) throw new Error("no video clip");
  const id = video.clipId;
  const len = (+video.endTick - +video.startTick) / 1e6;
  const begin = +video.startTick / 1e6;
  const exportAs = await exporter(ctx);
  /** Select the video with the playhead at `s` (seeking drops the selection) and open Audio › `sub`. */
  const at = async (s, sub = "Basic") => {
    await focus(ctx, doc, video, s);
    await tab(win, "Audio");
    await audioSub(win, sub);
  };

  // ---- as imported ----
  const plain = await exportAs("aui-plain");
  const p0 = pcm(plain, begin, Math.min(8, len - 0.3));
  const level = (x, from, to) => side(x, 0).slice(Math.round(from * 16000), Math.round(to * 16000));
  check(`the clip has sound (rms ${rms(p0).toFixed(4)})`, rms(p0) > 0.001);

  // ---- Basic ----
  await at(2);
  await shot("aui-1-basic");
  check("a video's Audio tab has CapCut's sub-tabs", (await inspector(win).locator("[role=tab]").allInnerTexts()).join(",").includes("Basic,Voice changer"));
  await undoCase(ctx, check, "volume typed", () => typeInto(win, "Volume", -6), { frame: false });
  await typeInto(win, "Fade in", 1);
  let c = await savedClip(ctx, id);
  check(`volume and fade in saved (${c.volume} dB, ${c.fadeIn} s)`, Math.abs(c.volume + 6) < 1e-6 && Math.abs(c.fadeIn - 1) < 1e-6);
  const e1 = pcm(await exportAs("aui-volume"), begin, Math.min(8, len - 0.3));
  const down = dbOf(level(e1, 2, 5), level(p0, 2, 5));
  check(`−6 dB: the export ${down.toFixed(2)} dB against the plain one`, Math.abs(down + 6) < 0.5);
  const fadeStart = dbOf(level(e1, 0, 0.1), level(p0, 0, 0.1));
  check(`fade in: its first 0.1 s ${fadeStart.toFixed(1)} dB down`, fadeStart < -20);
  await inspector(win).locator('[aria-label="Reset Basic"]').click();
  await win.waitForTimeout(300);
  c = await savedClip(ctx, id);
  check("↺ puts volume and fades back", (c.volume ?? 0) === 0 && (c.fadeIn ?? 0) === 0 && (c.fadeOut ?? 0) === 0, JSON.stringify({ v: c.volume, i: c.fadeIn, o: c.fadeOut }));

  // ---- volume keyframes ----
  await at(1);
  const diamond = () => inspector(win).locator("[data-keyframe=volume] button[aria-pressed]");
  await undoCase(ctx, check, "volume keyframe", () => settled(win, () => diamond().click()), { frame: false });
  check("the diamond shows the key at the playhead", (await diamond().getAttribute("aria-pressed")) === "true");
  await at(4);
  check("off the key, the diamond is hollow", (await diamond().getAttribute("aria-pressed")) === "false");
  await typeInto(win, "Volume", -20);
  c = await savedClip(ctx, id);
  const keys = c.keyframes?.volume ?? [];
  check(`typing with keys keys the playhead (${keys.map((k) => `${k.frame}:${k.value}`).join(" ")})`, keys.length === 2 && keys.some((k) => k.value === -20));
  await at(1);
  const v1 = await field(win, "Volume").inputValue();
  await at(4);
  const v4 = await field(win, "Volume").inputValue();
  check(`the field shows the keys' value at the playhead (${v1} at 1 s, ${v4} at 4 s)`, /^0\.0/.test(v1) && /^-20\.0/.test(v4));
  await shot("aui-2-keyframes");
  const e2 = pcm(await exportAs("aui-keyframes"), begin, Math.min(8, len - 0.3));
  const k1 = dbOf(level(e2, 0.3, 0.9), level(p0, 0.3, 0.9));
  const k4 = dbOf(level(e2, 4.2, 5.5), level(p0, 4.2, 5.5));
  check(`keys: the export ${k1.toFixed(1)} dB before 1 s and ${k4.toFixed(1)} dB after 4 s`, Math.abs(k1) < 0.5 && Math.abs(k4 + 20) < 1);
  await inspector(win).locator('[aria-label="Reset Basic"]').click();
  await win.waitForTimeout(300);
  check("↺ takes the volume keys off", !((await savedClip(ctx, id)).keyframes?.volume?.length));

  // ---- normalize loudness ----
  const l0 = integrated(plain, begin, Math.min(6, len - 0.5));
  const box = (name) => inspector(win).locator(`[role=checkbox][aria-label="${name} on"]`);
  const measured = async () => {
    for (let i = 0; i < 40; i++) {
      const t = (await inspector(win).locator("[data-testid=loudness-state]").innerText().catch(() => "")) || "";
      if (/LUFS target|silent/.test(t)) return t;
      await win.waitForTimeout(250);
    }
    return "";
  };
  await undoCase(ctx, check, "normalize loudness", async () => {
    await box("Normalize loudness").click();
    await measured();
  }, { frame: false });
  const line = await measured();
  c = await savedClip(ctx, id);
  const gain = Math.min(-23 - c.loudness.measured, -Math.min(c.loudness.peak, 0));
  check(`measured and shown: "${line}"`, c.loudness?.enabled && Number.isFinite(c.loudness.measured) && line.includes(`${gain >= 0 ? "+" : "−"}${Math.abs(gain).toFixed(1)} dB`));
  await shot("aui-3-normalize");
  const l3 = integrated(await exportAs("aui-normalized"), begin, Math.min(6, len - 0.5));
  check(`normalized: ${l3.toFixed(2)} LUFS from ${l0.toFixed(2)} (gain ${gain.toFixed(2)} dB)`, Math.abs(l3 - (l0 + gain)) < 0.6);
  await settled(win, () => box("Normalize loudness").click());
  c = await savedClip(ctx, id);
  check("unchecked, normalizing is off (the measurement kept)", c.loudness?.enabled === false && Number.isFinite(c.loudness.measured));

  // ---- fill channel ----
  await undoCase(ctx, check, "fill channel", () => settled(win, () => box("Fill channel").click()), { frame: false });
  check("checked: Fill right with left", (await savedClip(ctx, id)).channel === "left");
  await chooseFill(win, "Fill left with right");
  check("the menu picks Fill left with right", (await savedClip(ctx, id)).channel === "right");
  await shot("aui-4-fill");
  const e4 = pcm(await exportAs("aui-fill"), begin + 0.25, Math.min(6, len - 0.5));
  const lr = channelDifference;
  check(`fill: both channels alike (L−R ${lr(e4).toExponential(1)} of the level, ${lr(p0).toExponential(1)} before)`, lr(e4) < 0.01);

  // ---- voice changer ----
  await at(2, "Voice changer");
  await shot("aui-5-voice");
  const tile = (name) => inspector(win).locator(`[data-testid=voice-${name}]`);
  check("None is picked on a clip without effects", (await tile("none").getAttribute("aria-pressed")) === "true");
  await undoCase(ctx, check, "voice filter", () => settled(win, () => tile("telephone").click()), { frame: false });
  c = await savedClip(ctx, id);
  check(`Telephone on the clip (${JSON.stringify(c.audioEffects)})`, c.audioEffects?.length === 1 && c.audioEffects[0].type === "telephone");
  const sliders = await inspector(win).locator("[data-testid=voice-params] label").allInnerTexts();
  check(`its sliders: ${sliders.join(", ")}`, sliders.join(",") === "Drive,Strength");
  await inspector(win).locator("[data-testid=voice-params]").scrollIntoViewIfNeeded();
  await shot("aui-6-telephone");
  const e5 = pcm(await exportAs("aui-telephone"), begin + 0.25, Math.min(6, len - 0.5));
  const [s4, s5] = [spectralShape(e4), spectralShape(e5)];
  check(`telephone: lows ×${(s5.low / s4.low).toFixed(3)}, highs ×${(s5.high / s4.high).toFixed(3)} against the middle`, s5.low < s4.low * 0.1 && s5.high < s4.high * 0.1);
  await typeInto(win, "Strength", 0);
  check("Strength 0 saved", (await savedClip(ctx, id)).audioEffects?.[0]?.params?.strength === 0);
  const e6 = pcm(await exportAs("aui-strength0"), begin + 0.25, Math.min(6, len - 0.5));
  const off = residual(e4, e6);
  check(`strength 0: the clip as it was (difference ${(10 * Math.log10(off)).toFixed(1)} dB)`, off < 0.01);

  // Search and the group chips change what's listed; None takes the filter off.
  await win.locator("[data-testid=voice-search]").fill("tel");
  await win.waitForTimeout(200);
  const found = await inspector(win).locator("[data-testid=voice-tiles] button").allInnerTexts();
  check(`search "tel": ${found.join(", ")}`, found.join(",") === "None,Telephone");
  await win.locator("[data-testid=voice-search]").fill("");
  await inspector(win).getByRole("button", { name: "Space", exact: true }).click();
  await win.waitForTimeout(200);
  const space = await inspector(win).locator("[data-testid=voice-tiles] button").allInnerTexts();
  check(`the Space chip: ${space.join(", ")}`, space.join(",") === "None,Echo,Mic Echo,Small Room,Hall,Cathedral");
  await inspector(win).getByRole("button", { name: "All", exact: true }).click();
  await settled(win, () => tile("none").click());
  check("None takes the filter off", ((await savedClip(ctx, id)).audioEffects ?? []).length === 0);
  // For audiouicheck after reopen: Telephone at strength 0 again, Normalize on.
  await settled(win, () => tile("telephone").click());
  await typeInto(win, "Strength", 0);
  await at(2);
  await box("Normalize loudness").click();
  await measured();
  c = await savedClip(ctx, id);
  check("left for reopen: Normalize on, Fill left with right, Telephone at 0", c.loudness?.enabled && c.channel === "right" && c.audioEffects?.[0]?.params?.strength === 0);
  ctx.audioClipId = id;
  return report();
};
