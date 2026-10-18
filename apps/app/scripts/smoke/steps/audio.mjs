// The Audio tab's tools set through the store on the first video clip (after `import timeline`;
// a clip with sound, e.g. IMG_9079.MOV), checked in the sound of the engine's exports. The step
// imports the renderer's modules, so it needs its dev server: `npx vite --port 5199` in
// packages/renderer and the session run with MODE=development
// VITE_DEV_SERVER_URL=http://localhost:5199. Run it with OPENRIP_FAKE_MIC=1 (the voiceover then
// records the engine's stand-in tone: nothing real is recorded) and OPENRIP_ENGINE_MUTE=1.
//
// - An export as imported, for reference.
// - Normalize loudness (lib/audio.ts with the engine's meter): the clip's range reads −23 LUFS in
//   the export (ffmpeg's ebur128), whatever it read before.
// - Fill channel "left": the export's two channels are the same.
// - The Telephone preset (lib/audio-effects.ts): the lows and highs are gone, the middle stays.
// - The saved project has the fields; the engine plays a strength of 0 as the clip itself.
// - A voiceover: started and stopped through the preload, its level reported while recording,
//   the file in the project's media, placed with `placeVoiceover`; the export has its 440 Hz tone
//   where it was placed.
// - A converted draft's own voice filter (a "draft" entry) shows in the Voice changer as a tile
//   of its own, picked; a preset picked there replaces it.
import path from "node:path";
import { settled, tab } from "./_preview.mjs";
import { checks, focus, savedProject } from "./_anim.mjs";
import { act, band, channelDifference, exporter, integrated as loudnessOf, pcm, residual, side, spectralShape } from "./_audio.mjs";

const clipOf = (win) =>
  win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    const s = useClipStore.getState();
    const c = s.clips.filter((x) => x.type === "video").sort((a, b) => a.startFrame - b.startFrame)[0];
    return c && { fps, id: c.clipId, start: c.startFrame, end: c.endFrame, path: s.assets[c.assetId]?.path, duration: s.assets[c.assetId]?.duration };
  });

export default async (ctx) => {
  const { win, udDir, shot, fs } = ctx;
  const { check, report } = checks();
  const clip = await clipOf(win);
  if (!clip) throw new Error("no video clip");
  const { fps } = clip;
  const exportAs = await exporter(ctx);
  const begin = clip.start / fps;
  const seconds = Math.min(6, (clip.end - clip.start) / fps - 0.5);
  /** The export's integrated loudness over the clip. */
  const integrated = (file) => loudnessOf(file, begin, seconds);

  // ---- as imported ----
  const plain = await exportAs("audio-plain");
  const p0 = pcm(plain, begin + 0.25, seconds);
  const l0 = integrated(plain);
  check(`the clip has sound (${l0.toFixed(1)} LUFS)`, Number.isFinite(l0) && l0 > -60);

  // ---- normalize loudness ----
  const norm = await act(win, async ({ id, fps }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const audio = await import("/src/lib/audio.ts");
    const s = useClipStore.getState();
    const c = s.clips.find((x) => x.clipId === id);
    const measure = window[btoa("engineLoudness")];
    const patch = await audio.normalizeLoudness(c, s.assets[c.assetId].path, fps, measure, s.assets[c.assetId].duration);
    s.updateClip(id, patch);
    return patch.loudness;
  }, { id: clip.id, fps });
  check(`measured with the engine's meter (${norm?.measured?.toFixed(2)} LUFS, peak ${norm?.peak?.toFixed(2)})`, Number.isFinite(norm?.measured) && Math.abs(norm.measured - l0) < 3, JSON.stringify(norm));
  const normed = await exportAs("audio-normalised");
  const l1 = integrated(normed);
  const held = Math.min(-23 - norm.measured, -Math.min(norm.peak, 0));
  check(`normalised: the clip reads ${l1.toFixed(2)} LUFS (gain ${held.toFixed(2)} dB from ${l0.toFixed(2)})`, Math.abs(l1 - (l0 + held)) < 0.6);

  // ---- channel fill ----
  await act(win, async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const audio = await import("/src/lib/audio.ts");
    const s = useClipStore.getState();
    s.updateClip(id, audio.setChannelFill(s.clips.find((x) => x.clipId === id), "left"));
  }, clip.id);
  const filled = await exportAs("audio-left");
  const p2 = pcm(filled, begin + 0.25, seconds);
  const lr0 = channelDifference(p0);
  const lr2 = channelDifference(p2);
  check(`fill left: both channels the same (L−R ${lr2.toExponential(1)} of the level, ${lr0.toExponential(1)} before)`, lr2 < 0.01 && (lr2 < lr0 * 0.2 || lr0 < 0.01));

  // ---- a voice effect ----
  await act(win, async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const fx = await import("/src/lib/audio-effects.ts");
    const s = useClipStore.getState();
    s.updateClip(id, fx.applyPreset(s.clips.find((x) => x.clipId === id), "telephone"));
  }, clip.id);
  const phone = await exportAs("audio-telephone");
  const p3 = pcm(phone, begin + 0.25, seconds);
  const [s2, s3] = [spectralShape(p2), spectralShape(p3)];
  check(`telephone: lows and highs cut against the middle (lows ×${(s3.low / s2.low).toFixed(3)}, highs ×${(s3.high / s2.high).toFixed(3)})`, s3.low < s2.low * 0.1 && s3.high < s2.high * 0.1);
  await shot("a1-audio-tools");
  const saved = (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === clip.id);
  check("the saved clip has its effect, fill and loudness", saved?.audioEffects?.[0]?.type === "telephone" && saved?.channel === "left" && saved?.loudness?.enabled === true, JSON.stringify({ fx: saved?.audioEffects, channel: saved?.channel, loudness: saved?.loudness }));

  // ---- strength 0 is the clip itself ----
  await act(win, async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const fx = await import("/src/lib/audio-effects.ts");
    const s = useClipStore.getState();
    s.updateClip(id, fx.setEffectParam(s.clips.find((x) => x.clipId === id), 0, "strength", 0));
  }, clip.id);
  const dry = await exportAs("audio-strength0");
  const p4 = pcm(dry, begin + 0.25, seconds);
  const off = residual(p2, p4);
  check(`strength 0: the clip as it was (difference ${(10 * Math.log10(off)).toFixed(1)} dB)`, off < 0.01);

  // ---- voiceover, from the stand-in microphone ----
  const status = await win.evaluate(() => window[btoa("voiceoverStatus")]());
  check(`voiceover available (${JSON.stringify(status)})`, status.available && !status.recording);
  await win.evaluate(() => {
    window.__levels = [];
    window[btoa("onVoiceoverLevel")]((l) => window.__levels.push(l));
  });
  const started = await win.evaluate(() => window[btoa("voiceoverStart")]());
  check(`recording started (${JSON.stringify(started)})`, started.ok === true);
  await win.waitForTimeout(1500);
  const stopped = await win.evaluate(() => window[btoa("voiceoverStop")]());
  const levels = await win.evaluate(() => window.__levels);
  check(`its level came while it recorded (${levels.length} reports, peak ${Math.max(...levels.map((l) => l.peak)).toFixed(3)})`, levels.length >= 10 && levels.some((l) => Math.abs(l.peak - 0.25) < 0.02));
  check(`stopped: ${stopped.durationSec?.toFixed(2)} s in ${stopped.path}`, stopped.ok && stopped.durationSec > 1.2 && stopped.durationSec < 2.5 && fs.existsSync(stopped.path) && stopped.path.startsWith(udDir));
  const linked = path.join(path.dirname(path.dirname(stopped.path)), "symlinks", path.basename(stopped.path));
  check("it's in the project's media library", fs.existsSync(linked));
  const placed = await act(win, async ({ stopped, at }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const audio = await import("/src/lib/audio.ts");
    const fps = useControlsStore.getState().fps || 30;
    const c = audio.placeVoiceover(useClipStore.getState(), { path: stopped.path, durationSec: stopped.durationSec }, stopped.url, Math.round(at * fps), fps);
    return { id: c.clipId, start: c.startFrame, end: c.endFrame, fps, tracks: useClipStore.getState().timelines.filter((t) => t.type === "audio").length };
  }, { stopped, at: begin + 1 });
  check(`placed on its own audio track (${placed.end - placed.start} frames)`, placed.tracks >= 1 && Math.abs((placed.end - placed.start) / placed.fps - stopped.durationSec) < 0.05);
  const vo = await exportAs("audio-voiceover");
  // The tone at 440 Hz where the voiceover sits, against the plain export there.
  const at = placed.start / placed.fps;
  const tone = (file) => {
    const x = side(pcm(file, at + 0.2, 0.8), 0);
    return band(x, 430, 450) / Math.max(1e-12, band(x, 600, 620));
  };
  check(`the export has the voiceover's tone where it was placed (×${(tone(vo) / tone(dry)).toFixed(1)})`, tone(vo) > tone(dry) * 5);

  // ---- a converted draft's own voice filter, in the Voice changer ----
  await act(win, async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const fx = await import("/src/lib/audio-effects.ts");
    const s = useClipStore.getState();
    s.updateClip(id, fx.setAudioEffects(s.clips.find((x) => x.clipId === id), [{ type: "draft", id: "draft-filter", name: "Cartoon" }]));
  }, clip.id);
  const doc = await savedProject(win, udDir);
  await focus(ctx, doc, doc.timeline.clips.find((c) => c.clipId === clip.id), begin + 2);
  await tab(win, "Audio");
  await win.locator("[data-testid=inspector] [role=tab]", { hasText: /^Voice changer$/ }).click();
  await win.waitForTimeout(400);
  const draftTile = win.locator("[data-testid=voice-draft]");
  check(
    `a draft's voice filter shows as its own tile, picked, with no sliders ("${(await draftTile.innerText().catch(() => "")).replace(/\s+/g, " ")}")`,
    (await draftTile.getAttribute("aria-pressed")) === "true" && /Cartoon/.test(await draftTile.innerText()) && (await win.locator("[data-testid=voice-params]").count()) === 0,
  );
  await shot("a2-draft-filter");
  await settled(win, () => win.locator("[data-testid=voice-deep]").click());
  const picked = (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === clip.id)?.audioEffects ?? [];
  check(`picking a preset replaces it (${JSON.stringify(picked)})`, picked.length === 1 && picked[0].name === "Deep" && (await win.locator("[data-testid=voice-draft]").count()) === 0);
  return report();
};
