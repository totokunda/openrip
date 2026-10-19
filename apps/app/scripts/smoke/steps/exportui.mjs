// The Export dialog (after `import timeline`, and `newtext` for the captions; run on
// ~/Downloads/IMG_9079.MOV with CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1, built app, no dev
// server), as CapCut's (docs/plan/capcut-ui-spec.md §6.29): the cover and its Edit cover chip;
// the title; the Video, Audio, Export GIF and Captions sections with their checkboxes (a
// section that's off greys its rows); every menu with CapCut's options (resolution 480P to 8K,
// bit rate Lower / Recommended / Higher / Custom with a Kbps field, codec, format, frame rate,
// audio format, GIF resolution, caption format); the footer's duration and size following the
// choices; then real exports read back with ffprobe: a 720p 30 fps H.264 MP4 with sound, a
// custom bit rate, an audio-only MP3 (and WAV, AAC, FLAC), a GIF, an SRT and a TXT, all four
// kinds in one run with its progress and finished screens, a cancelled run leaving nothing,
// and the clip menu's Export as Video through the same dialog for one clip. Shots are named
// after the CapCut references (x01 ↔ 31-dialogs/016, x02 ↔ 017 … x11 ↔ 026).
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { checks, clipsWhere, savedProject, select, bar } from "./_anim.mjs";
import { rulerMap } from "./_preview.mjs";
import { ffmpeg } from "./_audio.mjs";

const FFPROBE = process.env.FFPROBE || "/opt/homebrew/bin/ffprobe";
const probe = (file, count = true) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", ...(count ? ["-count_frames"] : []), "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 26 }).toString());
const stream = (info, type) => info.streams.find((s) => s.codec_type === type);

export default async (ctx) => {
  const { app, win, shot, outDir, fs, udDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("files:reveal-in-folder");
    ipcMain.handle("files:reveal-in-folder", async (_e, p) => ({ success: true, data: { path: p } }));
  });
  const dialog = win.locator("[data-testid=export-dialog]");
  const T = (id) => dialog.locator(`[data-testid=${id}]`);
  const doc = await savedProject(win, udDir);
  const ratio = doc.settings.aspectRatio.width / doc.settings.aspectRatio.height;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const sizeAt = (short) => (ratio >= 1 ? [even(short * ratio), even(short)] : [even(short), even(short / ratio)]);
  const hasText = doc.timeline.clips.some((c) => c.type === "text");

  const open = async () => {
    await win.locator("[data-testid=export]").click();
    await dialog.waitFor({ state: "visible" });
    await win.waitForTimeout(500);
  };
  const close = async () => {
    await T("export-cancel").click().catch(() => {});
    await dialog.waitFor({ state: "hidden" });
  };
  const options = async (id, shotName) => {
    await T(id).scrollIntoViewIfNeeded();
    await T(id).click();
    await win.waitForTimeout(300);
    const items = win.locator(`[data-testid=${id}-option]`);
    const labels = (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    if (shotName) await shot(shotName);
    await win.keyboard.press("Escape");
    await win.waitForTimeout(200);
    return labels;
  };
  const SECTION = { "export-audio-format": "audio", "export-gif-resolution": "gif", "export-caption-format": "captions" };
  const choose = async (id, label) => {
    // A menu of a section that's off can't open: turn the section on first, as a person would.
    if (SECTION[id]) await setCheck(SECTION[id], true);
    await T(id).scrollIntoViewIfNeeded();
    await T(id).click();
    await win.waitForTimeout(250);
    await win.locator(`[data-testid=${id}-option]`).filter({ hasText: label }).first().click();
    await win.waitForTimeout(200);
  };
  const setCheck = async (id, on) => {
    const box = T(`export-${id}-check`);
    if ((await box.count()) === 0) return;
    await box.scrollIntoViewIfNeeded();
    if (((await box.getAttribute("data-checked")) === "true") !== on) await box.click();
    await win.waitForTimeout(100);
  };
  const estimate = async () => ({ bytes: +(await T("export-estimate").getAttribute("data-bytes")), seconds: +(await T("export-estimate").getAttribute("data-seconds")), text: await T("export-estimate").innerText() });
  const finish = async () => {
    for (let i = 0; i < 600; i++) {
      const phase = await T("export-run").getAttribute("data-phase").catch(() => null);
      if (phase && phase !== "running") return phase;
      await win.waitForTimeout(500);
    }
    throw new Error("export never ended");
  };
  /** Export with only these parts on; returns the files the finished screen lists. */
  const exportParts = async (name, parts, { keep = false } = {}) => {
    await setCheck("video", !!parts.video);
    await setCheck("audio", !!parts.audio);
    await setCheck("gif", !!parts.gif);
    await setCheck("captions", !!parts.captions);
    await T("export-name").fill(name);
    await T("export-path").fill(outDir);
    await T("export-submit").click();
    const phase = await finish();
    const files = await T("export-file").evaluateAll((els) => els.map((e) => e.innerText));
    if (!keep) {
      await T("export-run-done").click();
      await dialog.waitFor({ state: "hidden" });
    }
    return { phase, files };
  };
  const file = (name) => path.join(outDir, name);
  const clean = (...names) => names.forEach((n) => fs.rmSync(file(n), { force: true }));
  clean("ex-720.mp4", "ex-rate.mp4", "ex-audio.mp3", "ex-audio.wav", "ex-audio.m4a", "ex-audio.flac", "ex-gif.gif", "ex-caps.srt", "ex-caps.txt", "ex-all.mp4", "ex-all.mp3", "ex-all.gif", "ex-all.srt", "ex-cancel.mp4", "ex-clip.mp4");

  // ---- the dialog ----------------------------------------------------------------------------
  await open();
  const box = await dialog.boundingBox();
  check(`the dialog is CapCut's size, 720 × 663 (${Math.round(box.width)} × ${Math.round(box.height)})`, Math.abs(box.width - 720) < 2 && Math.abs(box.height - 663) < 2);
  check("its title is Export- and the project's name", /^Export-\S/.test(await T("export-title").innerText()), await T("export-title").innerText());
  check("the cover on the left, with the Edit cover chip", (await T("export-cover").isVisible()) && /Edit cover/.test(await T("export-edit-cover").innerText()));
  check("the top rows: Export timeline, Name, Export to", /Export timeline/.test(await T("export-settings").innerText()) && (await T("export-name").isVisible()) && (await T("export-path").isVisible()));
  const parts = ["video", "audio", "gif", "captions"];
  const titles = await Promise.all(parts.map((p) => T(`export-section-${p}`).locator("span").first().innerText().catch(() => "")));
  check(`the sections, each with a checkbox: ${titles.join(", ")}`, (await Promise.all(parts.map((p) => T(`export-${p}-check`).count()))).every((n) => n === 1));
  const states = await Promise.all(parts.map((p) => T(`export-${p}-check`).getAttribute("data-checked")));
  check(`Video and Audio on, GIF and Captions off, as CapCut opens (${states.join(",")})`, states.join(",") === "true,true,false,false");
  check("the video rows: Resolution, Bit rate, Codec, Format, Frame rate, Color space (Rec. 709 SDR)", (await Promise.all(["export-resolution", "export-bitrate", "export-codec", "export-format", "export-fps"].map((i) => T(i).count()))).every((n) => n === 1) && /Rec\. 709 SDR/.test(await T("export-colorspace").innerText()));
  const foot = await estimate();
  check(`the footer: ${foot.text}`, /^Duration: \d+s \| Size: about [\d.]+ (MB|KB|GB)$/.test(foot.text));
  await shot("x01-settings");
  // Edit cover opens the cover editor (lib/cover.ts); cancelling it comes back to Export.
  await T("export-edit-cover").click();
  await win.locator("[data-testid=cover-dialog]").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check("Edit cover opens the cover editor", await win.locator("[data-testid=cover-dialog]").isVisible());
  await win.locator("[data-testid=cover-cancel]").click().catch(() => {});
  await win.waitForTimeout(400);
  if (!(await T("export-cover").isVisible().catch(() => false))) {
    await win.locator("[data-testid=export]").click();
    await T("export-cover").waitFor({ state: "visible", timeout: 5000 });
  }

  // ---- every menu ----------------------------------------------------------------------------
  const res = await options("export-resolution", "x02-resolution-menu");
  check(`Resolution: ${res.join(", ")}`, res.join(",") === "480P,720P,1080P,2K,4K,8K");
  const rate = await options("export-bitrate", "x03-bitrate-menu");
  check(`Bit rate: ${rate.join(", ")}`, rate.join(",") === "Lower,Recommended,Higher,Custom");
  const codecs = await options("export-codec", "x05-codec-menu");
  check(`Codec, each with its line: ${codecs.join(" | ")}`, /^H\.264 The most common compression method$/.test(codecs[0]) && /^HEVC Efficient compression, saving space$/.test(codecs[1]) && (codecs.length === 2 || codecs.length === 7)); // 7 where the platform encoder has HEVC with alpha and ProRes (exportcodecs checks them)
  const formats = await options("export-format", "x06-format-menu");
  check(`Format: ${formats.join(", ")}`, formats.join(",") === "mov,mp4");
  const fpsList = await options("export-fps", "x07-frame-rate-menu");
  check(`Frame rate: ${fpsList.join(", ")}`, fpsList.join(",") === "24fps,25fps,29.97fps,30fps,50fps,59.94fps,60fps");
  check("the menus leave the choice as it was (1080P, Recommended, H.264, mp4)", (await T("export-resolution").getAttribute("data-value")) === "1080" && (await T("export-bitrate").getAttribute("data-value")) === "recommended" && (await T("export-codec").getAttribute("data-value")) === "h264" && (await T("export-format").getAttribute("data-value")) === "mp4");

  // Audio, GIF and captions, scrolled into view; WAV and the GIF and captions off, as CapCut's capture.
  await choose("export-audio-format", "WAV");
  const af = await options("export-audio-format", "x09-audio-format-menu");
  check(`Audio format: ${af.join(", ")}`, af.join(",") === "MP3,WAV,AAC,FLAC");
  // A section that's off greys its rows (the menus open once it's on, as in CapCut's captures).
  await T("export-gif-resolution").scrollIntoViewIfNeeded();
  check("GIF and Captions are off: their menus are greyed", (await T("export-gif-resolution").isDisabled()) && (await T("export-caption-format").isDisabled()));
  await setCheck("gif", true);
  await setCheck("captions", true);
  const gifRes = await options("export-gif-resolution", "x10-gif-resolution-menu");
  check(`GIF resolution: ${gifRes.join(", ")}`, gifRes.join(",") === "240P,320P,640P");
  const capFmt = await options("export-caption-format", "x11-caption-format-menu");
  check(`Caption format: ${capFmt.join(", ")}, encoding UTF-8`, capFmt.join(",") === "SRT,TXT" && /Unicode \/ UTF-8/.test(await T("export-section-captions").innerText()));
  check("GIF and Captions on: their menus are live", (await T("export-gif-resolution").isEnabled()) && (await T("export-caption-format").isEnabled()));
  await setCheck("gif", false);
  await setCheck("captions", false);
  await T("export-section-captions").scrollIntoViewIfNeeded();
  await dialog.locator("[data-testid=export-settings]").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await win.waitForTimeout(200);
  await shot("x08-audio-gif-captions");
  await T("export-resolution").scrollIntoViewIfNeeded();
  await dialog.locator("[data-testid=export-settings]").evaluate((el) => (el.scrollTop = 0));

  // ---- bit rate: presets and Custom, and the size following them ----------------------------------
  await setCheck("audio", false);
  const at = async (label) => {
    await choose("export-bitrate", label);
    return (await estimate()).bytes;
  };
  const lower = await at("Lower");
  const recommended = await at("Recommended");
  const higher = await at("Higher");
  check(`the size follows the bit rate: Lower ${lower} < Recommended ${recommended} < Higher ${higher}`, lower < recommended && recommended < higher);
  await choose("export-bitrate", "Custom");
  const kbpsField = T("export-bitrate-custom");
  const started = +(await kbpsField.inputValue());
  check(`Custom opens a Kbps field with the preset's number (${started})`, started > 1000 && /Kbps/.test(await T("export-section-video").innerText()));
  await shot("x04-custom-bitrate");
  await kbpsField.fill("6000");
  const s6 = await estimate();
  const hasSound = !!stream(probe(ctx.clipPath, false), "audio");
  const want = ((6000 * 1000 + (hasSound ? 192_000 : 0)) * s6.seconds) / 8;
  check(`6000 Kbps: the footer says ${(s6.bytes / 1e6).toFixed(1)} MB for ${s6.seconds}s (bit rate × length ${(want / 1e6).toFixed(1)} MB)`, Math.abs(s6.bytes - want) / want < 0.02);
  await kbpsField.fill("3000");
  const s3 = await estimate();
  check("3000 Kbps: about half of that", Math.abs(s3.bytes / s6.bytes - (3000 + 192) / (6000 + 192)) < 0.02);
  await setCheck("video", false);
  check("Video off: its rows grey and the size drops to nothing (no audio, GIF or captions on)", (await T("export-resolution").isDisabled()) && (await T("export-bitrate").isDisabled()) && (await estimate()).bytes === 0);
  await setCheck("audio", true);
  const ap = (await estimate()).bytes;
  check(`Audio on its own: ${(ap / 1e6).toFixed(2)} MB (WAV, 44.1 kHz stereo 16-bit)`, Math.abs(ap - (1411 * 1000 * s6.seconds) / 8) / ((1411 * 1000 * s6.seconds) / 8) < 0.02);
  await setCheck("video", true);
  await setCheck("audio", false);
  await close();

  // ---- real exports ----------------------------------------------------------------------------
  // 720p, 30 fps, H.264, mp4, with the project's sound.
  await open();
  await choose("export-resolution", "720P");
  await choose("export-bitrate", "Recommended");
  await choose("export-codec", "H.264");
  await choose("export-format", "mp4");
  await choose("export-fps", "30fps");
  const r1 = await exportParts("ex-720", { video: true });
  const i1 = fs.existsSync(file("ex-720.mp4")) ? probe(file("ex-720.mp4")) : null;
  const v1 = i1 && stream(i1, "video");
  const a1 = i1 && stream(i1, "audio");
  const [w720, h720] = sizeAt(720);
  check(`a 720p 30 fps H.264 MP4: ${v1?.codec_name} ${v1?.width}×${v1?.height} ${v1?.r_frame_rate}, ${v1?.nb_read_frames} frames`, r1.phase === "done" && v1?.codec_name === "h264" && +v1.width === w720 && +v1.height === h720 && v1.r_frame_rate === "30/1" && i1.format.format_name.includes("mp4"));
  check(`with sound: ${a1?.codec_name} ${a1?.sample_rate} Hz, ${a1?.channels} ch`, !hasSound || (a1?.codec_name === "aac" && a1.sample_rate === "44100" && +a1.channels === 2));
  const dur = +i1.format.duration;
  check(`its length is the project's (${dur.toFixed(2)} s against the footer's ${foot.seconds} s)`, Math.abs(dur - foot.seconds) < 0.6);

  // A custom bit rate, within 10%.
  await open();
  await choose("export-resolution", "720P");
  await choose("export-bitrate", "Custom");
  await T("export-bitrate-custom").fill("3000");
  await choose("export-fps", "30fps");
  const r2 = await exportParts("ex-rate", { video: true });
  const i2 = fs.existsSync(file("ex-rate.mp4")) ? probe(file("ex-rate.mp4")) : null;
  const v2 = i2 && stream(i2, "video");
  const kbps2 = i2 ? (+v2.bit_rate || (fs.statSync(file("ex-rate.mp4")).size * 8) / +i2.format.duration) / 1000 : 0;
  check(`Custom 3000 Kbps: the video is ${kbps2.toFixed(0)} Kbps (within 10%)`, r2.phase === "done" && Math.abs(kbps2 - 3000) / 3000 <= 0.1);

  // A frame rate the project isn't in: 24 fps.
  await open();
  await choose("export-bitrate", "Lower");
  await choose("export-fps", "24fps");
  await exportParts("ex-24", { video: true });
  const i24 = fs.existsSync(file("ex-24.mp4")) ? probe(file("ex-24.mp4")) : null;
  const v24 = i24 && stream(i24, "video");
  check(`24 fps: ${v24?.r_frame_rate}, ${v24?.nb_read_frames} frames for ${(+i24?.format.duration).toFixed(2)} s`, v24?.r_frame_rate === "24/1" && Math.abs(+v24.nb_read_frames - 24 * +i24.format.duration) <= 2);

  // Audio only: MP3 (and the other formats).
  const audio = {};
  for (const [label, ext, codec] of [["MP3", "mp3", "mp3"], ["WAV", "wav", "pcm_s16le"], ["AAC", "m4a", "aac"], ["FLAC", "flac", "flac"]]) {
    await open();
    await choose("export-audio-format", label);
    const r = await exportParts("ex-audio", { audio: true });
    const f = file(`ex-audio.${ext}`);
    const i = fs.existsSync(f) ? probe(f) : null;
    const a = i && stream(i, "audio");
    audio[label] = a;
    check(`audio only, ${label}: ${a?.codec_name} ${a?.sample_rate} Hz ${a?.channels} ch, ${i ? (+i.format.duration).toFixed(2) : "?"} s, no picture`, r.phase === "done" && a?.codec_name === codec && a.sample_rate === "44100" && +a.channels === 2 && !stream(i, "video") && Math.abs(+i.format.duration - foot.seconds) < 0.6);
    if (label === "MP3") fs.copyFileSync(f, file("ex-audio-kept.mp3"));
  }
  const level = spawnSync(ffmpeg, ["-v", "info", "-i", file("ex-audio-kept.mp3"), "-af", "volumedetect", "-f", "null", "-"]).stderr.toString();
  const mean = +/mean_volume: (-?[\d.]+) dB/.exec(level)?.[1];
  check(`the sound is in the file, not silence (MP3 mean level ${mean} dB)`, !hasSound || mean > -45);

  // GIF.
  await open();
  await choose("export-gif-resolution", "240P");
  const r4 = await exportParts("ex-gif", { gif: true });
  const i4 = fs.existsSync(file("ex-gif.gif")) ? probe(file("ex-gif.gif")) : null;
  const v4 = i4 && stream(i4, "video");
  const [wg, hg] = sizeAt(240);
  check(`a GIF: ${v4?.codec_name} ${v4?.width}×${v4?.height}, ${v4?.nb_read_frames} frames, ${i4 ? (+i4.format.duration).toFixed(2) : "?"} s`, r4.phase === "done" && v4?.codec_name === "gif" && Math.min(+v4.width, +v4.height) === 240 && Math.abs(+v4.width - wg) <= 1 && Math.abs(+v4.height - hg) <= 1 && Math.abs(+i4.format.duration - foot.seconds) < 0.6);
  await open();
  await choose("export-gif-resolution", "320P");
  await exportParts("ex-gif", { gif: true });
  const i4b = probe(file("ex-gif.gif"));
  check(`320P: the shorter side is ${Math.min(+stream(i4b, "video").width, +stream(i4b, "video").height)}`, Math.min(+stream(i4b, "video").width, +stream(i4b, "video").height) === 320);

  // Captions: SRT and TXT.
  await open();
  check(`Captions on: ${hasText ? "the text is on the timeline" : "nothing on the timeline says so"}`, true);
  await choose("export-caption-format", "SRT");
  await setCheck("captions", true);
  const none = await T("export-captions-none").count();
  check("the Captions section notes when the timeline has no texts", (none === 1) === !hasText);
  await T("export-name").fill("ex-caps");
  await T("export-path").fill(outDir);
  await setCheck("video", false);
  await setCheck("audio", false);
  await setCheck("gif", false);
  await T("export-submit").click();
  await finish();
  const srt = fs.existsSync(file("ex-caps.srt")) ? fs.readFileSync(file("ex-caps.srt"), "utf8") : "";
  if (hasText) {
    const timing = /^1\n(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})\n.+/m.test(srt);
    const clip = clipsWhere(doc, (c) => c.type === "text")[0];
    check(`an SRT: ${JSON.stringify(srt.slice(0, 60))}`, timing && srt.includes(String(clip.text).trim().split("\n")[0]) && srt.startsWith("1\n00:00:00,000 -->"));
  } else {
    check("an SRT: nothing to write without a text, and the screen says so", srt === "" && /no captions/i.test(await T("export-run").innerText()));
  }
  await shot("x13-finished");
  await T("export-run-done").click();
  await dialog.waitFor({ state: "hidden" });
  await open();
  await choose("export-caption-format", "TXT");
  await setCheck("video", false);
  await setCheck("audio", false);
  await setCheck("gif", false);
  await setCheck("captions", true);
  await T("export-name").fill("ex-caps");
  await T("export-path").fill(outDir);
  await T("export-submit").click();
  await finish();
  const txt = fs.existsSync(file("ex-caps.txt")) ? fs.readFileSync(file("ex-caps.txt"), "utf8") : "";
  check(`a TXT: the words alone ${JSON.stringify(txt.slice(0, 40))}`, hasText ? txt.trim().length > 0 && !/-->/.test(txt) : txt === "");
  await T("export-run-done").click();
  await dialog.waitFor({ state: "hidden" });

  // All four in one run: the progress screen, then the finished one.
  await open();
  await setCheck("video", true);
  await choose("export-resolution", "720P");
  await choose("export-bitrate", "Higher");
  await choose("export-audio-format", "MP3");
  await choose("export-caption-format", "SRT");
  await setCheck("video", true);
  await setCheck("audio", true);
  await setCheck("gif", true);
  await setCheck("captions", true);
  await T("export-name").fill("ex-all");
  await T("export-path").fill(outDir);
  await T("export-submit").click();
  await win.waitForTimeout(1200);
  const mid = {
    phase: await T("export-run").getAttribute("data-phase"),
    percent: await T("export-percent").innerText().catch(() => ""),
    cancel: await T("export-run-cancel").count(),
    topbar: await win.locator("[data-testid=export]").count(),
  };
  check(`the run shows its progress (${mid.phase}, ${mid.percent}) with Cancel`, mid.phase === "running" && mid.cancel === 1 && /%$/.test(mid.percent));
  await shot("x12-progress");
  // Closing the window leaves it running; the top bar shows it, and clicking it brings the dialog back.
  await T("export-run-background").click();
  await dialog.waitFor({ state: "hidden" });
  await win.waitForTimeout(500);
  check("closed mid-run, the top bar's Export button shows the progress", (await win.locator("[data-testid=export]").count()) === 0 && /\d+%/.test(await win.locator("body").innerText()));
  await win.getByText(/Exporting/).first().click();
  await dialog.waitFor({ state: "visible" });
  const phase = await finish();
  const listed = await T("export-file").evaluateAll((els) => els.map((e) => e.innerText.split("\n")[0]));
  await shot("x13-finished-all");
  check(`finished: ${listed.join(", ")} written`, phase === "done" && listed.join(",") === "Video,Audio,GIF,Captions" && ["ex-all.mp4", "ex-all.mp3", "ex-all.gif"].every((n) => fs.existsSync(file(n))) && (!hasText || fs.existsSync(file("ex-all.srt"))));
  check("the finished screen has Open folder and Done", (await T("export-open-folder").count()) === 1 && (await T("export-run-done").count()) === 1);
  await T("export-run-done").click();
  await dialog.waitFor({ state: "hidden" });

  // Cancel: a 4K export stopped part way leaves no file.
  await open();
  await setCheck("video", true);
  await choose("export-resolution", "4K");
  await choose("export-fps", "30fps");
  await setCheck("video", true);
  await setCheck("audio", false);
  await setCheck("gif", false);
  await setCheck("captions", false);
  await T("export-name").fill("ex-cancel");
  await T("export-path").fill(outDir);
  await T("export-submit").click();
  for (let i = 0; i < 40 && !((await T("export-percent").innerText().catch(() => "0%")) !== "0%"); i++) await win.waitForTimeout(250);
  await T("export-run-cancel").click();
  const endPhase = await finish();
  await win.waitForTimeout(500);
  check(`Cancel stops the run (${endPhase}) and leaves no file`, endPhase === "cancelled" && !fs.existsSync(file("ex-cancel.mp4")));
  await T("export-run-done").click();
  await dialog.waitFor({ state: "hidden" });

  // ---- one clip: the clip menu's Export as Video -----------------------------------------------------
  const now = await savedProject(win, udDir);
  const video = clipsWhere(now, (c) => c.type === "video")[0];
  await select(ctx, now, video.clipId);
  const [bx, by] = await bar(ctx, now, video.clipId);
  await win.mouse.click(bx, by, { button: "right" });
  await win.waitForTimeout(500);
  await win.getByText("Export as Video", { exact: true }).click();
  await dialog.waitFor({ state: "visible" });
  await win.waitForTimeout(500);
  check("Export as Video opens the same dialog for the clip (no Captions section, 'Selected clip')", (await T("export-section-captions").count()) === 0 && /Selected clip/.test(await T("export-settings").innerText()) && (await T("export-section-video").count()) === 1);
  await shot("x14-clip-export");
  await setCheck("video", true);
  await choose("export-resolution", "720P");
  await choose("export-fps", "30fps");
  const r6 = await exportParts("ex-clip", { video: true });
  const i6 = fs.existsSync(file("ex-clip.mp4")) ? probe(file("ex-clip.mp4")) : null;
  const clipSeconds = (+video.endTick - +video.startTick) / 1e6;
  check(`the clip alone: ${i6 ? (+i6.format.duration).toFixed(2) : "?"} s for a clip of ${clipSeconds.toFixed(2)} s`, r6.phase === "done" && !!i6 && Math.abs(+i6.format.duration - clipSeconds) < 0.6);

  return report();
};
