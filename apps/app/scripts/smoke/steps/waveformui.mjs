// The timeline's waveforms against CapCut's (after `import timeline` on IMG_9079 with
// CLIP_NAME=IMG_9079; OPENRIP_ENGINE_MUTE=1). The step imports the renderer's modules, so it
// needs its dev server as `keyframes` does. With CAPCUT_REF set to the CapCut reference folder
// it also reads CapCut's own bars from 03-editor-overview/003 (the clip's sound extracted to an
// audio clip) and 18-inspector-video/001 (the video with its sound, in its bottom band).
// - CapCut's bars against lib/waveform.ts on the engine's buckets for the same file, at CapCut's
//   37.35 px/s: the audio clip and the video band, bar by bar;
// - the video on the main track: its name and length chips, its waveform in its 16 px band;
// - ⇧⌘S: the band empties, the audio clip in the colour of a video's sound (lib/timeline-colors.ts) with its name chip and its waveform;
// - volume −6 dB and a fade in from the Audio tab: the bars and the line come down by CapCut's
//   scale, the line from the bottom through the fade;
// - a trim, twice the speed, reverse: the drawn bars follow the media;
// - zoomed in: still 1 px every 2 px;
// - the track's "…" menu: Track height Tall (a taller clip, taller bars) and Audio waveform size
//   60% (bars twice as tall), each one undo step and saved with the track.
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { ffmpeg } from "./_audio.mjs";
import { rulerMap, settled } from "./_preview.mjs";
import { checks, clipsWhere, focus, savedProject, select } from "./_anim.mjs";
import { typeInto, undoCase } from "./_undo.mjs";
import { key } from "./_timeline.mjs";
import { audioSub } from "./audioui.mjs";

/** What the timeline draws for a clip's sound: its bars (x px from its left, height), line and band height. */
const drawn = (win, clipId) =>
  win.evaluate((id) => {
    const nodes = (window.Konva?.stages ?? []).flatMap((s) => s.find(".waveform")).filter((n) => n.getAttr("clipId") === id);
    const n = nodes[0];
    return n ? { bars: n.getAttr("heights"), line: n.getAttr("line"), area: n.getAttr("area"), max: n.getAttr("maxBar"), pxPerFrame: n.getAttr("pxPerFrame") } : null;
  }, clipId);
const chips = (win, clipId) =>
  win.evaluate((id) => (window.Konva?.stages ?? []).flatMap((s) => s.find(".clip-chips")).find((n) => n.getAttr("clipId") === id)?.getAttr("chips") ?? null, clipId);

/**
 * CapCut's bars in a reference screenshot: per bar (2 device px on, 2 off, from `left` + 3), its
 * height (CSS px). The PNG is read as raw RGB by ffmpeg, its colours as stored.
 */
const referenceBars = (file, { left, right, bottom, bar, over }) => {
  const info = spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr ?? "";
  const width = Number(/Video: png.*?, (\d+)x\d+/.exec(info)?.[1] ?? 0);
  if (!width) throw new Error(`can't read ${file}`);
  const d = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 26 });
  const px = (x, y) => {
    const i = (y * width + x) * 3;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const is = (c, list) => list.some((l) => l[0] === c[0] && l[1] === c[1] && l[2] === c[2]);
  const heights = [];
  for (let x = left + 3; x + 1 < right; x += 4) {
    let h = 0;
    for (const cx of [x, x + 1]) {
      if (!is(px(cx, bottom - 1), [bar, over])) continue;
      for (let y = bottom - 1; y > bottom - 80; y--) {
        const c = px(cx, y);
        if (is(c, [bar, over])) h = Math.max(h, bottom - y);
        else if (!is(c, [[89, 127, 132], [80, 122, 126], [36, 82, 86]])) break;
      }
    }
    heights.push(h / 2);
  }
  return heights;
};

const corr = (a, b) => {
  const n = Math.min(a.length, b.length);
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
};
const meanAbs = (a, b) => {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
};
/** A drawn waveform's envelope: the mean bar height per `step` s, at `pps` px a second. */
const envelope = (bars, pps, seconds, step = 0.25) => {
  const out = new Array(Math.ceil(seconds / step)).fill(0);
  const n = new Array(out.length).fill(0);
  for (const b of bars) {
    const i = Math.floor(b.x / pps / step);
    if (i >= 0 && i < out.length) (out[i] += b.h), n[i]++;
  }
  return out.map((v, i) => (n[i] ? v / n[i] : 0));
};

export default async (ctx) => {
  const { app, win, shot } = ctx;
  const { check, report } = checks();
  ctx.map = await rulerMap(win);
  let doc = await savedProject(win, ctx.udDir);
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  if (!video) throw new Error("no video clip");
  const seconds = (+video.endTick - +video.startTick) / 1e6;

  // ---- the model against CapCut's own bars ----
  const ref = process.env.CAPCUT_REF;
  if (ref) {
    const model = await win.evaluate(async ({ id }) => {
      const { useClipStore } = await import("/src/lib/clip.ts");
      const { useControlsStore } = await import("/src/lib/control.ts");
      const wf = await import("/src/lib/waveform.ts");
      const src = await import("/src/lib/waveform-source.ts");
      const s = useClipStore.getState();
      const c = s.clips.find((x) => x.clipId === id);
      const fps = useControlsStore.getState().fps || 30;
      const buckets = await src.waveformOf(s.assets[c.assetId].path);
      const at = (scale, max) =>
        wf.clipBars(c, buckets, { fps, pxPerFrame: 37.35 / fps, fromPx: 0, toPx: 1e6, scale, max }).reduce((m, b) => ((m[Math.round((b.x - 1.5) / 2)] = b.h), m), []);
      return { audio: Array.from(at(wf.AUDIO_SCALE, 48), (v) => v ?? 0), band: Array.from(at(wf.BAND_SCALE, 16), (v) => v ?? 0) };
    }, { id: video.clipId });
    const capAudio = referenceBars(path.join(ref, "03-editor-overview/003-base-timeline-built.png"), { left: 367, right: 1224, bottom: 1771, bar: [51, 117, 125], over: [98, 158, 164] });
    const capBand = referenceBars(path.join(ref, "18-inspector-video/001-video-selected-basic-top.png"), { left: 367, right: 1224, bottom: 1664, bar: [51, 117, 125], over: [90, 152, 159] });
    // Both sides, for a look when it fails.
    ctx.fs.writeFileSync(path.join(ctx.outDir, "wf-compare.json"), JSON.stringify({ model, capAudio, capBand }));
    const n = Math.min(capAudio.length, model.audio.length);
    check(
      `the audio clip's bars against CapCut's (003), bar by bar: correlation ${corr(model.audio, capAudio).toFixed(3)}, ${meanAbs(model.audio, capAudio).toFixed(2)} px off on average over ${n} bars`,
      corr(model.audio, capAudio) > 0.95 && meanAbs(model.audio, capAudio) < 1.2,
    );
    check(
      `the video band's bars against CapCut's (001): correlation ${corr(model.band, capBand).toFixed(3)}, ${meanAbs(model.band, capBand).toFixed(2)} px off on average`,
      corr(model.band, capBand) > 0.9 && meanAbs(model.band, capBand) < 1,
    );
  }

  // ---- the video's bands ----
  const vchips = await chips(win, video.clipId);
  check(`the video's chips: ${JSON.stringify(vchips)}`, vchips?.[0] === "IMG_9079.MOV" && /^00:00:11:\d\d$/.test(vchips?.[1] ?? ""));
  let band = await drawn(win, video.clipId);
  check(`its own sound in its 16 px band (${band?.bars.length} bars, the tallest ${band?.max} px)`, band?.area === 16 && band.bars.length > 50 && band.max > 4 && band.max <= 16);
  check("bars 1 px every 2 px", band.bars.every((b, i) => i === 0 || (b.x - band.bars[i - 1].x) % 2 === 0));
  await shot("w-1-video-band");

  // ---- detached ----
  await focus(ctx, doc, video, 1);
  await key(win, "Meta+Shift+s");
  await win.waitForTimeout(1200);
  doc = await savedProject(win, ctx.udDir);
  const sound = doc.timeline.clips.find((c) => c.type === "audio");
  const videoNow = clipsWhere(doc, (c) => c.type === "video")[0];
  check("detached: the video's band is empty", !(await drawn(win, videoNow.clipId)));
  const achips = await chips(win, sound.clipId);
  let a0 = await drawn(win, sound.clipId);
  check(`the audio clip: its name chip ${JSON.stringify(achips)}, its waveform over the clip (${a0?.bars.length} bars, the tallest ${a0?.max} px)`, achips?.[0] === "IMG_9079" && a0?.area === 50 && a0.max > 10 && a0.max <= 30.5);
  const body = await win.evaluate((id) => {
    const n = (window.Konva?.stages ?? []).flatMap((s) => s.find(".waveform")).find((x) => x.getAttr("clipId") === id);
    return n?.getParent()?.getChildren()?.[0]?.fill?.();
  }, sound.clipId);
  const fromVideo = await win.evaluate(async () => (await import("/src/lib/timeline-colors.ts")).TIMELINE_COLORS.fromVideoBg);
  check(`in the colour of a video's sound (${body}, fromVideoBg ${fromVideo})`, body === fromVideo);
  check(`the volume line at 13 px (${a0.line[0].h.toFixed(2)})`, Math.abs(a0.line[0].h - 13) < 0.01);
  await select(ctx, doc, sound.clipId, 4);
  // The video's thumbnails for its new (`#video`) asset come a moment later.
  await win.waitForTimeout(2500);
  await shot("w-2-detached");

  // ---- volume and fades, from the Audio tab ----
  await audioSub(win, "Basic");
  await typeInto(win, "Volume", -6);
  await win.waitForTimeout(800);
  const a1 = await drawn(win, sound.clipId);
  const drop = 13 - a1.line[0].h;
  const barDrop = a0.max - a1.max;
  check(`−6 dB: the line ${drop.toFixed(2)} px down and the tallest bar ${barDrop.toFixed(1)} px (the bars' scale: 6 × 30.5 / 52 = 3.5)`, Math.abs(drop - (6 * 30.5) / 52) < 0.01 && Math.abs(barDrop - (6 * 30.5) / 52) <= 0.6);
  await typeInto(win, "Fade in", 2);
  await win.waitForTimeout(800);
  const a2 = await drawn(win, sound.clipId);
  const early = a2.bars.filter((b) => b.x < ctx.map.pps * 0.3);
  check(`fade in: the line from the bottom (${a2.line[0].h}), the first bars small (${early.map((b) => b.h).join(" ") || "none"})`, a2.line[0].h === 0 && early.every((b) => b.h < 6));
  await win.locator("[data-testid=inspector]").locator('[aria-label="Reset Basic"]').click();
  await win.waitForTimeout(800);
  const base = await drawn(win, sound.clipId);
  const fps = doc.settings?.fps || 24;
  // Each state at its own px a second (the timeline re-zooms when the project's length changes).
  const ppsOf = (d) => d.pxPerFrame * fps;
  const env0 = envelope(base.bars, ppsOf(base), seconds);

  // ---- trims, speed, reverse: the bars follow the media ----
  // Each a step of its own (a key press starts one), so ⌘Z takes it back.
  const patch = async (fn) => {
    await win.keyboard.press("Shift");
    await settled(win, () =>
      win.evaluate(async ({ id, fn }) => {
        const { useClipStore } = await import("/src/lib/clip.ts");
        const sp = await import("/src/lib/speed.ts");
        const s = useClipStore.getState();
        const c = s.clips.find((x) => x.clipId === id);
        const f = new Function("c", "sp", "s", fn);
        f(c, sp, s);
      }, { id: sound.clipId, fn }),
    );
  };
  const trim = Math.round(2 * fps);
  await patch(`s.updateClip(c.clipId, { trimStart: (c.trimStart || 0) + ${trim}, startFrame: c.startFrame + ${trim} })`);
  await win.waitForTimeout(800);
  const t1 = await drawn(win, sound.clipId);
  const trimmed = envelope(t1.bars, ppsOf(t1), seconds);
  // The trimmed clip starts 2 s later and plays from 2 s in: on the timeline, the same bars (its
  // envelope from its own left edge, 8 quarter-seconds on).
  const kept = corr(trimmed.slice(0, 36), env0.slice(8, 44));
  check(`trimmed 2 s: the bars stay on the sound (correlation ${kept.toFixed(3)})`, kept > 0.97);
  await key(win, "Meta+z");
  await patch("s.updateClip(c.clipId, { speed: 2 })");
  await win.waitForTimeout(800);
  // At twice the speed a px plays twice the media: the envelope over media time.
  const t2 = await drawn(win, sound.clipId);
  const fast = envelope(t2.bars, ppsOf(t2) / 2, seconds);
  check(`twice the speed: the bars at t show the sound at 2t (correlation ${corr(fast, env0).toFixed(3)})`, corr(fast.slice(0, 44), env0.slice(0, 44)) > 0.85);
  await key(win, "Meta+z");
  await patch("s.updateClip(c.clipId, sp.reversePatch(c, true))");
  await win.waitForTimeout(800);
  const t3 = await drawn(win, sound.clipId);
  const back = envelope(t3.bars, ppsOf(t3), seconds);
  const mirrored = [...env0].reverse();
  check(`reversed: the bars mirrored (correlation ${corr(back, mirrored).toFixed(3)})`, corr(back.slice(1, -1), mirrored.slice(1, -1)) > 0.85);
  await key(win, "Meta+z");

  // ---- zoomed in ----
  await key(win, "Meta+=");
  await key(win, "Meta+=");
  await win.waitForTimeout(800);
  const zoomed = await drawn(win, sound.clipId);
  check(`zoomed in: still 1 px every 2 px (${zoomed.bars.length} bars against ${base.bars.length})`, zoomed.bars.every((b, i) => i === 0 || (b.x - zoomed.bars[i - 1].x) % 2 === 0) && zoomed.bars.length > 0);
  await key(win, "Shift+z");
  await win.waitForTimeout(800);

  // ---- the track's "…" menu ----
  ctx.map = await rulerMap(win);
  doc = await savedProject(win, ctx.udDir);
  const track = () => win.locator('button[title="Track menu"]').last();
  const pick = async (row, item) => {
    await track().click();
    await win.waitForTimeout(300);
    await win.locator(`[data-testid=menu-${row}]`).hover();
    await win.waitForTimeout(300);
    await win.locator(`[data-testid=menu-${item}]`).click();
    await win.waitForTimeout(800);
  };
  await track().click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=menu-waveform-size]").hover();
  await win.waitForTimeout(300);
  await shot("w-3-waveform-menu");
  await win.keyboard.press("Escape");
  const before = await drawn(win, sound.clipId);
  await undoCase(ctx, check, "track height", () => pick("track-height", "track-height-tall"), { frame: false });
  const tall = await drawn(win, sound.clipId);
  const savedTrack = (await savedProject(win, ctx.udDir)).timeline.tracks.find((t) => t.timelineId === sound.timelineId);
  check(`Tall: the clip ${tall.area} px, the tallest bar ${tall.max} against ${before.max} (×1.4), saved "${savedTrack.size}"`, tall.area === 70 && Math.abs(tall.max / before.max - 1.4) < 0.08 && savedTrack.size === "tall");
  await pick("track-height", "track-height-default");
  await undoCase(ctx, check, "waveform size", () => pick("waveform-size", "waveform-size-60"), { frame: false });
  const big = await drawn(win, sound.clipId);
  const sizedTrack = (await savedProject(win, ctx.udDir)).timeline.tracks.find((t) => t.timelineId === sound.timelineId);
  check(`60%: the tallest bar ${big.max} against ${before.max} (×2), saved ${sizedTrack.waveform}`, Math.abs(big.max / before.max - 2) < 0.1 && sizedTrack.waveform === 60);
  await track().click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=menu-track-height]").hover();
  await win.waitForTimeout(300);
  await shot("w-4-height-menu");
  await win.keyboard.press("Escape");
  return report();
};
