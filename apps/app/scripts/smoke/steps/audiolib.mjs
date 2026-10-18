// The left panel's Audio tab (after `import timeline` on a clip with sound, e.g. IMG_9079 with
// CLIP_NAME; OPENRIP_ENGINE_MUTE=1; the file picker is stubbed with files made here by ffmpeg):
// - Extracted lists the video's sound; its + puts it on a new audio track at the playhead (the
//   export is the plain one plus itself a second later); the Extract audio card imports
//   another video (a 660 Hz tone), listed too;
// - Voiceovers, empty, says how to record one and opens the Voiceover panel;
// - Music and Sound effects say they're coming, with nothing posing as content, and import an
//   audio file (an 880 Hz tone): listed under "Your audio files", its + puts it at the playhead
//   and the export has it there;
// - with several clips with sound, the Voice changer's Apply to all puts a pick on each.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { rulerMap, seek, settled, tab } from "./_preview.mjs";
import { checks, focus, savedProject } from "./_anim.mjs";
import { band, dbOf, exporter, ffmpeg, pcm, residual, side } from "./_audio.mjs";
import { audioSub } from "./audioui.mjs";

const rows = (win, section) => win.locator(`[data-testid=audio-section-${section}] [data-testid=audio-row]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
const open = async (win, section) => {
  await win.locator(`[data-testid=assets-section-${section}]`).click();
  await win.waitForTimeout(1200);
};
/** The next file pickers answer with `files`. */
const pickReturns = (app, files) =>
  app.evaluate(({ ipcMain }, files) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => files);
  }, files);

export default async (ctx) => {
  const { app, win, shot, outDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const exportAs = await exporter(ctx);
  const plain = await exportAs("al-plain");
  const doc0 = await savedProject(win, ctx.udDir);
  const video = doc0.timeline.clips.find((c) => c.type === "video");
  const name = path.basename(decodeURIComponent(new URL(doc0.assets[video.assetId].path).pathname));

  await win.locator("[data-testid=assets-tab-audio]").click();
  await open(win, "extracted");
  const listed = await rows(win, "extracted");
  check(`Extracted lists the video's sound (${listed.join(", ")})`, listed.includes(name));
  await shot("al-1-extracted");

  // Its + at the playhead (1 s): the same sound again, a second behind the video's own.
  await seek(win, ctx.map, 1);
  await settled(win, () => win.locator("[data-testid=audio-section-extracted] [data-testid=audio-row]", { has: win.locator(`text=${name}`) }).locator("[data-testid=audio-row-add]").click());
  const doc1 = await savedProject(win, ctx.udDir);
  const sound = doc1.timeline.clips.find((c) => c.type === "audio");
  const soundPath = decodeURIComponent(doc1.assets[sound?.assetId]?.path ?? "");
  check(`+ puts it on a new audio track at the playhead (${sound ? (+sound.startTick / 1e6).toFixed(3) : "none"} s, ${soundPath.split("/").pop()})`, !!sound && Math.abs(+sound.startTick / 1e6 - 1) < 0.05 && soundPath.endsWith(`${name}#audio`));
  const begin = +video.startTick / 1e6;
  const twice = await exportAs("al-extracted");
  // What both should sum to: the plain export plus itself a second later.
  const [own, late] = [side(pcm(plain, begin + 2, 3), 0), side(pcm(plain, begin + 1, 3), 0)];
  const expected = own.map((v, i) => v + (late[i] ?? 0));
  const off = residual(expected, side(pcm(twice, begin + 2, 3), 0));
  check(`the export plays both, the extracted sound from 1 s (off the sum by ${(10 * Math.log10(off)).toFixed(1)} dB; ${dbOf(expected, own).toFixed(1)} dB up)`, off < 0.05);
  check("the row says it's added", (await win.locator(`[data-testid=audio-row][data-name="${name}"]`).innerText()).includes("Added"));

  // The Extract audio card brings in another video.
  const toneVideo = path.join(outDir, "al-tone-660.mp4");
  execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x240:d=2", "-f", "lavfi", "-i", "sine=frequency=660:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", toneVideo]);
  await pickReturns(app, [toneVideo]);
  await win.locator("[data-testid=audio-extract]").click();
  let got = [];
  for (let i = 0; i < 30 && !(got = await rows(win, "extracted")).includes("al-tone-660.mp4"); i++) await win.waitForTimeout(500);
  check(`Extract audio's Import lists another video's sound (${got.join(", ")})`, got.includes("al-tone-660.mp4"));

  // ---- Voiceovers, empty ----
  await open(win, "voiceovers");
  const empty = await win.locator("[data-testid=audio-section-voiceovers]").innerText();
  check(`Voiceovers says how to record one ("${empty.replace(/\s+/g, " ").trim()}")`, /No voiceovers yet/.test(empty));
  await shot("al-2-voiceovers");
  await win.locator("[data-testid=audio-section-voiceovers] [data-testid=audio-record]").click();
  await win.waitForTimeout(500);
  check("its button opens the Voiceover panel", await win.locator("[data-testid=voiceover-panel]").isVisible());
  await win.locator("[data-testid=voiceover-close]").click();

  // ---- Music and Sound effects ----
  await open(win, "music");
  const music = await win.locator("[data-testid=audio-section-music]").innerText();
  check(`Music says it's coming, with no items (${(await rows(win, "music")).length} rows)`, /music library is coming/.test(music) && (await rows(win, "music")).length === 0);
  await shot("al-3-music");
  const tone = path.join(outDir, "al-tone-880.wav");
  execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-ac", "2", tone]);
  await pickReturns(app, [tone]);
  await win.locator("[data-testid=audio-section-music] [data-testid=audio-import]").click();
  let mine = [];
  for (let i = 0; i < 30 && !(mine = await rows(win, "music")).includes("al-tone-880.wav"); i++) await win.waitForTimeout(500);
  check(`Import audio lists the file under "Your audio files" (${mine.join(", ")})`, mine.includes("al-tone-880.wav"));
  await shot("al-4-music-imported");
  await seek(win, ctx.map, 6);
  await settled(win, () => win.locator('[data-testid=audio-row][data-name="al-tone-880.wav"] [data-testid=audio-row-add]').click());
  const placed = (await savedProject(win, ctx.udDir)).timeline.clips.filter((c) => c.type === "audio").map((c) => +c.startTick / 1e6);
  check(`its + puts it at the playhead (audio clips at ${placed.map((s) => s.toFixed(2)).join(", ")} s)`, placed.some((s) => Math.abs(s - 6) < 0.05));
  const withTone = side(pcm(await exportAs("al-music"), begin + 6.2, 1), 0);
  const ratio = band(withTone, 870, 890) / Math.max(1e-12, band(withTone, 1000, 1020));
  check(`the export has the file's 880 Hz tone at 6 s (×${ratio.toFixed(0)} against 1010 Hz)`, ratio > 20);
  await open(win, "sounds");
  const sfx = await win.locator("[data-testid=audio-section-sounds]").innerText();
  check("Sound effects says it's coming, and lists the imported file", /Sound effects are coming/.test(sfx) && (await rows(win, "sounds")).includes("al-tone-880.wav"));

  // Voice changer's Apply to all, now that several clips have sound: one pick sets them all.
  const doc2 = await savedProject(win, ctx.udDir);
  await focus(ctx, doc2, doc2.timeline.clips.find((c) => c.type === "video"), 2);
  await tab(win, "Audio");
  await audioSub(win, "Voice changer");
  const inspector = win.locator("[data-testid=inspector]");
  await inspector.locator('[role=checkbox][aria-label="Apply to all"]').click();
  await settled(win, () => inspector.locator("[data-testid=voice-robot]").click());
  const all = (await savedProject(win, ctx.udDir)).timeline.clips.filter((c) => c.type === "video" || c.type === "audio");
  check(`Apply to all: Robot on every clip with sound (${all.map((c) => c.audioEffects?.[0]?.type ?? "none").join(", ")})`, all.length === 3 && all.every((c) => c.audioEffects?.[0]?.type === "robot"));
  await shot("al-5-apply-all");
  return report();
};
