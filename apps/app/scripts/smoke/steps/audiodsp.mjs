// Reduce noise and Make volume consistent (on a fresh project, alone): a fixture of 8 s made with
// FFmpeg from the clip's picture and synthetic sound: 4 s of steady noise (white, 0.03) with a
// 440 Hz tone from 1.5 s (0.25), then the same 12 dB quieter, split at 4 s (A loud, B quiet).
// Each feature is turned on through the UI, the saved project checked, and the export measured:
// - Reduce noise on A (Audio tab ▸ Basic ▸ Reduce noise; one undo step): the export's noise-only
//   stretch (0.2–1.3 s) at least 12 dB down, the tone's band within 1.5 dB; the clip menu's
//   Enhance audio › Reduce noise is ticked; off gives the clip's sound back;
// - Project tab ▸ Global edits ▸ Make volume consistent (one undo step): both clips take
//   Normalize loudness to one target and the export's two halves read within 1 LU (12 apart
//   before); off gives back the clips' own settings (and the 12 dB).
import { seek, rulerMap, tab } from "./_preview.mjs";
import { bar, checks, savedProject, select } from "./_anim.mjs";
import { press, undoCase } from "./_undo.mjs";
import { buildFixture, ffmpegPath, placeOnTimeline } from "./_fixture.mjs";
import { band, dbOf, exporter, integrated, pcm, residual, rms, side } from "./_audio.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/** The video (its picture 8 s from the clip) with the synthetic sound muxed in. */
const withSound = (ctx) => {
  const pic = buildFixture(ctx, "dsp-pic.mp4", [{ from: 0.5, frames: 240 }]);
  const file = path.join(ctx.outDir, "dsp.mp4");
  const part = (i, db) => `anoisesrc=d=4:c=white:r=48000:a=0.03:seed=${3 + i}[n${i}];aevalsrc='0.25*sin(2*PI*440*t)*gte(t,1.5)':s=48000:d=4[t${i}];[n${i}][t${i}]amix=inputs=2:normalize=0,volume=${db}dB[m${i}]`;
  const graph = `${part(0, 0)};${part(1, -12)};[m0][m1]concat=n=2:v=0:a=1,aformat=channel_layouts=stereo[out]`;
  execFileSync(ffmpegPath(), ["-v", "error", "-y", "-i", pic.file, "-filter_complex", graph, "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", file]);
  return file;
};

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  await placeOnTimeline(ctx, withSound(ctx), "dsp.mp4");
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 4);
  await win.locator("[data-testid=tool-split]").click();
  await win.waitForTimeout(800);
  const videos = (doc) => doc.timeline.clips.filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  let doc = await savedProject(win, udDir);
  const [a, b] = videos(doc);
  check("two clips, A (loud) then B (quiet), cut at 4 s", videos(doc).length === 2 && Math.abs(+b.startTick / 1e6 - 4) < 0.05);
  const saved = async (id) => videos(await savedProject(win, udDir)).find((c) => c.clipId === id);
  const exportAs = await exporter(ctx);
  const inspector = win.locator("[data-testid=inspector]");
  const box = (name) => inspector.locator(`[role=checkbox][aria-label="${name} on"]`);
  const left = (x, from, to) => side(x, 0).slice(Math.round(from * 16000), Math.round(to * 16000));

  // ---- as imported ----
  const plain = await exportAs("dsp-plain");
  const p0 = pcm(plain, 0, 8);
  const floor0 = rms(left(p0, 0.2, 1.3));
  const tone0 = band(left(p0, 2, 3.5), 400, 480);
  check(`A's noise floor is there (rms ${floor0.toFixed(4)}) and its tone`, floor0 > 0.003 && tone0 > 0);
  const la0 = integrated(plain, 0.3, 3.4);
  const lb0 = integrated(plain, 4.3, 3.4);
  check(`A and B read ${la0.toFixed(1)} and ${lb0.toFixed(1)} LUFS (about 12 apart)`, Math.abs(la0 - lb0 - 12) < 2);

  // ---- Reduce noise ----
  await seek(win, ctx.map, 2);
  await select(ctx, doc, a.clipId, 2);
  await tab(win, "Audio");
  await win.waitForTimeout(500);
  await shot("dsp-1-audio-tab");
  await undoCase(ctx, check, "Reduce noise", async () => {
    await box("Reduce noise").click();
    await win.waitForTimeout(500);
  }, { frame: false });
  let c = await saved(a.clipId);
  check("A's Reduce noise is on in the saved project, B's isn't", c.denoise?.enabled === true && !(await saved(b.clipId)).denoise?.enabled, JSON.stringify(c.denoise));
  check("the checkbox shows it", (await box("Reduce noise").getAttribute("aria-checked")) === "true");
  await shot("dsp-2-reduce-noise");
  const p1 = pcm(await exportAs("dsp-denoise"), 0, 8);
  const drop = dbOf(left(p0, 0.2, 1.3), left(p1, 0.2, 1.3));
  const toneMove = 10 * Math.log10(band(left(p1, 2, 3.5), 400, 480) / tone0);
  check(`the noise-only stretch is ${drop.toFixed(1)} dB down`, drop > 12);
  check(`the tone's band moved ${toneMove.toFixed(2)} dB`, Math.abs(toneMove) < 1.5);
  const bSame = residual(p0.slice(4.2 * 32000, 7.8 * 32000), p1.slice(4.2 * 32000, 7.8 * 32000));
  check(`B (Reduce noise off) is as it was (difference ${(10 * Math.log10(Math.max(bSame, 1e-12))).toFixed(1)} dB)`, bSame < 0.001);
  // The clip menu: Enhance audio › Reduce noise, ticked.
  doc = await savedProject(win, udDir);
  const [x, y] = await bar(ctx, doc, a.clipId, 1);
  await win.mouse.click(x, y, { button: "right" });
  await win.waitForTimeout(500);
  await win.locator("[data-testid=menu-enhance-audio]").hover();
  await win.waitForTimeout(500);
  await shot("dsp-3-menu");
  const item = win.locator("[data-testid=menu-reduce-noise]");
  check("the clip menu's Enhance audio lists Reduce noise", await item.isVisible().catch(() => false));
  await item.click();
  await win.waitForTimeout(800);
  check("clicking it in the menu turns it off", (await saved(a.clipId)).denoise?.enabled === false);
  await press(win, "Meta+z");
  await win.waitForTimeout(800);
  check("⌘Z turns it back on", (await saved(a.clipId)).denoise?.enabled === true);
  await select(ctx, await savedProject(win, udDir), a.clipId, 2);
  await tab(win, "Audio");
  await box("Reduce noise").click();
  await win.waitForTimeout(800);
  check("the checkbox turns it off", (await saved(a.clipId)).denoise?.enabled === false);
  const p2 = pcm(await exportAs("dsp-denoise-off"), 0, 8);
  const back = residual(p0.slice(0, 4 * 32000), p2.slice(0, 4 * 32000));
  check(`off: A's sound is back (difference ${(10 * Math.log10(Math.max(back, 1e-12))).toFixed(1)} dB)`, back < 0.001);

  // ---- Make volume consistent ----
  await press(win, "Escape");
  await seek(win, ctx.map, 6);
  await win.locator("[data-testid=project-tab-project]").click();
  await win.waitForTimeout(400);
  const row = win.locator("[data-testid=make-volume-consistent]");
  check("Global edits lists Make volume consistent", await row.isVisible());
  await shot("dsp-4-project-tab");
  const measured = async () => {
    for (let i = 0; i < 60; i++) {
      if (!(await win.locator("[data-testid=volume-consistent-note]").count())) return;
      await win.waitForTimeout(250);
    }
  };
  await undoCase(ctx, check, "Make volume consistent", async () => {
    await win.locator("[data-testid=make-volume-consistent-on]").click();
    await measured();
    await win.waitForTimeout(500);
  }, { frame: false });
  const [ca, cb] = [await saved(a.clipId), await saved(b.clipId)];
  const target = ca.loudness?.target;
  check(`both clips normalize to one target (${target} and ${cb.loudness?.target} LUFS)`, ca.loudness?.enabled && cb.loudness?.enabled && target === cb.loudness.target && ca.loudness.consistent && cb.loudness.consistent);
  check("the checkbox shows it", (await win.locator("[data-testid=make-volume-consistent-on]").getAttribute("aria-checked")) === "true");
  await shot("dsp-5-consistent");
  const consistent = await exportAs("dsp-consistent");
  const [la, lb] = [integrated(consistent, 0.3, 3.4), integrated(consistent, 4.3, 3.4)];
  check(`the export's halves read ${la.toFixed(2)} and ${lb.toFixed(2)} LUFS (12 apart before): within 1 LU of each other`, Math.abs(la - lb) < 1);
  check(`and at the target (${target} LUFS) within 1.5 LU`, Math.abs(la - target) < 1.5 && Math.abs(lb - target) < 1.5);
  await win.locator("[data-testid=make-volume-consistent-on]").click();
  await win.waitForTimeout(800);
  const [oa, ob] = [await saved(a.clipId), await saved(b.clipId)];
  check("off: the clips' own loudness settings are back (none)", !oa.loudness && !ob.loudness, JSON.stringify([oa.loudness, ob.loudness]));
  const e2 = await exportAs("dsp-consistent-off");
  const [ra, rb] = [integrated(e2, 0.3, 3.4), integrated(e2, 4.3, 3.4)];
  check(`the halves are ${(ra - rb).toFixed(1)} LU apart again`, Math.abs(ra - rb - 12) < 2);
  return report();
};
