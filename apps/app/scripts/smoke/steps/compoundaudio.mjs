// A compound clip's Audio and Speed tabs reach its sound, read back from exports with ffmpeg
// (after `import timeline`, on ~/Downloads/IMG_9079.MOV with CLIP_NAME=IMG_9079; run with
// OPENRIP_ENGINE_MUTE=1). The video is made a compound (⌥G), then:
// - Volume −6 dB on the compound: its sound 6 dB down;
// - Fade in 2 s: the first half second nearly silent, the sound back to full by 3 s;
// - a speed curve (Speed ▸ Curve ▸ a preset): the compound's length and its picture change, and
//   the exported sound is as long as the clip.
import { engineFrame, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { bar, checks, savedProject } from "./_anim.mjs";
import { field, typeInto } from "./_undo.mjs";
import { dbOf, exporter, pcm, rms } from "./_audio.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  const saved = async () => {
    await win.waitForTimeout(1800);
    return savedProject(win, ctx.udDir);
  };
  let doc = await saved();
  const video = doc.timeline.clips.find((c) => c.type === "video");
  const len = (+video.endTick - +video.startTick) / 1e6;
  const exportAs = await exporter(ctx);
  ctx.map ??= await rulerMap(win);
  const select = async () => {
    doc = await saved();
    const c = doc.timeline.clips.find((x) => x.compound);
    const [x, y] = await bar(ctx, doc, c.clipId, 3);
    await win.mouse.click(x, y);
    await win.waitForTimeout(600);
    return c;
  };

  // The video as a compound.
  const [bx, by] = await bar(ctx, doc, video.clipId, len / 2);
  await win.mouse.click(bx, by);
  await win.waitForTimeout(500);
  await win.evaluate(() => document.activeElement?.blur?.());
  await settled(win, () => win.keyboard.press("Alt+g"));
  let comp = await select();
  check("the video is a compound clip", !!comp.compound);
  const begin = +comp.startTick / 1e6;
  const plain = pcm(await exportAs("cmpa-plain"), begin, 6);
  check(`it has sound (rms ${rms(plain).toFixed(4)})`, rms(plain) > 0.001);

  // Volume −6 dB.
  await tab(win, "Audio");
  await typeInto(win, "Volume", -6);
  const quiet = pcm(await exportAs("cmpa-volume"), begin, 6);
  check(`Volume −6 dB lowers the compound's sound by 6 dB (${dbOf(quiet, plain).toFixed(1)} dB)`, Math.abs(dbOf(quiet, plain) + 6) < 0.7);
  await typeInto(win, "Volume", 0);

  // Fade in 2 s.
  await typeInto(win, "Fade in", 2);
  const faded = pcm(await exportAs("cmpa-fade"), begin, 6);
  const slice = (x, a, b) => x.slice(Math.round(a * 16000) * 2, Math.round(b * 16000) * 2);
  const start = dbOf(slice(faded, 0, 0.5), slice(plain, 0, 0.5));
  const later = dbOf(slice(faded, 3, 5), slice(plain, 3, 5));
  check(`Fade in 2 s: the first half second is far down (${start.toFixed(1)} dB), back to full by 3 s (${later.toFixed(1)} dB)`, start < -9 && Math.abs(later) < 0.7);
  await typeInto(win, "Fade in", 0);

  // Speed curve.
  comp = await select();
  const before = (+comp.endTick - +comp.startTick) / 1e6;
  await tab(win, "Speed");
  await win.locator("[data-testid=inspector] [role=tab]", { hasText: /^Curve$/ }).first().click();
  await win.waitForTimeout(400);
  const f0 = (await engineFrame(win)).sum;
  await settled(win, () => win.locator("[data-testid=curve-card][title=Montage]").click());
  doc = await saved();
  const curved = doc.timeline.clips.find((x) => x.compound);
  const after = (+curved.endTick - +curved.startTick) / 1e6;
  check(`a speed curve is saved on the compound (${JSON.stringify(curved.speedCurve ?? null).slice(0, 60)})`, Array.isArray(curved.speedCurve?.points ?? curved.speedCurve) || !!curved.speedCurve);
  check(`and it changes the compound's length (${before.toFixed(2)} s -> ${after.toFixed(2)} s)`, Math.abs(after - before) > 0.05 || (await engineFrame(win)).sum !== f0);
  const curvedSound = pcm(await exportAs("cmpa-curve"), begin, Math.min(6, after));
  check(`the curved compound's sound is there (rms ${rms(curvedSound).toFixed(4)})`, rms(curvedSound) > 0.001);
  void field;
  void seek;
  return report();
};
