// The Text tab's spacing, gradient fill, outlines, glow and Effects styles set through the store
// on a text added from lib/text-presets.ts, and captions read from fixtures/captions.srt with
// lib/captions.ts and written back out (after `import timeline`). The engine's frames are
// checked. The step imports the renderer's modules, so it needs the renderer from its dev
// server (as `keyframes`): `npx vite --port 5199` in packages/renderer and the session with
// MODE=development VITE_DEV_SERVER_URL=http://localhost:5199.
//
// Checks: the text is drawn; Character spacing widens it by the steps CapCut's panel gives
// (1/20 em each) and Line spacing spreads its lines; a gradient goes red to blue across it;
// a second outline reaches further, in its colour; a glow lights well around it, in its
// colour; an Effects style changes it and taking it off puts it back; glow keyframes brighten
// it over time; the saved project keeps the fields; the captions land on a track of their own
// with the file's timing (the overlap ended at the next start), each shown at its time; and
// the track writes back out as the same SRT.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { engineFrame, grab, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

const fixture = fileURLToPath(new URL("../fixtures/captions.srt", import.meta.url));

// The pixels that differ (by more than `tol` in a channel) between two grabbed frames: how
// many, their box, and the mean colour of the second frame there, overall and in the box's
// left and right thirds.
const changed = (win, a, b, tol = 30) => win.evaluate(({ a, b, tol }) => {
  const [x, y] = [window.__grabs[a], window.__grabs[b]];
  const w = x.width;
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const px = [];
  for (let i = 0; i < x.data.length; i += 4) {
    if (Math.abs(x.data[i] - y.data[i]) > tol || Math.abs(x.data[i + 1] - y.data[i + 1]) > tol || Math.abs(x.data[i + 2] - y.data[i + 2]) > tol) {
      const p = i / 4, cx = p % w, cy = Math.floor(p / w);
      n++;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      px.push([cx, y.data[i], y.data[i + 1], y.data[i + 2]]);
    }
  }
  const mean = (list) => list.length ? [1, 2, 3].map((k) => list.reduce((s, p) => s + p[k], 0) / list.length) : [0, 0, 0];
  const third = (x1 - x0) / 3;
  return { n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, rgb: mean(px), left: mean(px.filter((p) => p[0] < x0 + third)), right: mean(px.filter((p) => p[0] > x1 - third)) };
}, { a, b, tol });

// Set fields on a clip through the store and wait for the engine to redraw.
const update = (win, id, fields) =>
  settled(win, () => win.evaluate(async ({ id, fields }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    useClipStore.getState().updateClip(id, fields);
  }, { id, fields }));

const r = (v) => +v.toFixed(1);

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const map = (ctx.map = await rulerMap(win));
  const fps = await win.evaluate(async () => (await import("/src/lib/control.ts")).useControlsStore.getState().fps || 30);
  const [t0, t1] = [Math.round(0.5 * fps) / fps, Math.round(1.8 * fps) / fps];
  // The picture without the text, at the times the glow keyframes are checked and at 1 s.
  await seek(win, map, t0);
  await grab(win, "base0");
  await seek(win, map, t1);
  await grab(win, "base1");
  await seek(win, map, 1);
  await grab(win, "base");
  const yellowPx = async () => (await engineFrame(win, "r > 200 && g > 200 && b < 80")).count;
  const yellow0 = await yellowPx();

  // A text from the presets on a new track at the top, 0–3 s.
  const text = await settled(win, () => win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const { useViewportStore } = await import("/src/lib/viewport.ts");
    const { presetTextClip, textPreset } = await import("/src/lib/text-presets.ts");
    const fps = useControlsStore.getState().fps || 30;
    const { aspectRatio } = useViewportStore.getState();
    const canvas = { width: (600 * aspectRatio.width) / aspectRatio.height, height: 600 };
    const timelineId = crypto.randomUUID();
    useClipStore.getState().addTimeline({ timelineId, type: "text", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
    const clip = presetTextClip(textPreset("plain"), { clipId: crypto.randomUUID(), timelineId, startFrame: 0, fps, canvas, seconds: 3 });
    Object.assign(clip, { text: "ABC", fontSize: 48, fontWeight: 700, color: "#ffffff" });
    useClipStore.getState().addClip(clip);
    window.__textId = clip.clipId;
    return { id: clip.clipId, fontSize: 48 };
  }));
  const id = await win.evaluate(() => window.__textId);
  await grab(win, "plain");
  const plain = await changed(win, "base", "plain");
  const frame = await engineFrame(win);
  // The font size in the engine frame's pixels (the world is 600 units tall).
  const em = (48 / 600) * frame.h;
  check(`the text is drawn (${plain.n} px, ${plain.w}×${plain.h})`, text && plain.n > 100);
  await shot("ts1-text");

  // Character 10: two gaps of half an em more.
  await update(win, id, { letterSpacing: 10 });
  await grab(win, "spaced");
  const spaced = await changed(win, "base", "spaced");
  const grew = spaced.w - plain.w;
  check(`Character 10 widens it by about an em (${grew} px for ${r(em)})`, Math.abs(grew - em) < 0.2 * em + 3);
  // Line 10 on two lines: half an em more between them.
  await update(win, id, { letterSpacing: 0, text: "AB\nCD" });
  await grab(win, "lines");
  const lines = await changed(win, "base", "lines");
  await update(win, id, { lineSpacing: 10 });
  await grab(win, "lines2");
  const lines2 = await changed(win, "base", "lines2");
  check(`Line 10 spreads the lines by about half an em (${lines2.h - lines.h} px for ${r(em / 2)})`, Math.abs(lines2.h - lines.h - em / 2) < 0.2 * em + 3);
  await shot("ts2-spacing");
  await update(win, id, { lineSpacing: 0, text: "ABCDEF" });
  await grab(win, "wide");
  const wide = await changed(win, "base", "wide");

  // A gradient across the whole text: red on the left, blue on the right.
  await update(win, id, { fillGradient: { colors: ["#ff0000", "#0000ff"], angle: 0, span: "text" } });
  await grab(win, "gradient");
  const grad = await changed(win, "base", "gradient");
  check(`a gradient runs red to blue (left ${grad.left.map(Math.round)}, right ${grad.right.map(Math.round)})`, grad.left[0] > grad.left[2] + 60 && grad.right[2] > grad.right[0] + 60);
  await shot("ts3-gradient");
  await update(win, id, { fillGradient: null });

  // A stroke and a second, yellow outline 8 px out.
  await update(win, id, { strokeEnabled: true, stroke: "#000000", strokeWidth: 3, moreStrokes: [{ color: "#ffff00", width: 8 }] });
  await grab(win, "outlined");
  const outlined = await changed(win, "base", "outlined");
  const yellow = (await yellowPx()) - yellow0;
  const reach = ((8 / 600) * frame.h * 2);
  check(`a second outline reaches 8 px out, in yellow (${outlined.w - wide.w} px wider for ${r(reach)}; ${yellow} more yellow px)`, Math.abs(outlined.w - wide.w - reach) < 0.35 * reach + 3 && yellow > 200);
  await shot("ts4-outlines");
  await update(win, id, { strokeEnabled: false, moreStrokes: [] });

  // A green glow: light well outside the text.
  await update(win, id, { glowEnabled: true, glowColor: "#00ff00", glowIntensity: 40, glowRange: 25 });
  await grab(win, "glow");
  const glow = await changed(win, "base", "glow", 12);
  check(`a glow lights around the text (${glow.n} px vs ${wide.n}; box ${glow.w}×${glow.h} vs ${wide.w}×${wide.h}; mean ${glow.rgb.map(Math.round)})`, glow.n > 3 * wide.n && glow.w > wide.w + em && glow.rgb[1] > glow.rgb[0] + 20);
  await shot("ts5-glow");

  // Glow keyframes: none at 0 s, full at 2 s; the light, against the picture without the text
  // at the same moments (the clip moves under it), spreads as it goes.
  await update(win, id, { keyframes: { glowIntensity: [{ frame: 0, value: 0 }, { frame: 2 * fps, value: 100 }] } });
  await seek(win, map, t0);
  await grab(win, "kf0");
  await seek(win, map, t1);
  await grab(win, "kf1");
  await seek(win, map, 1);
  await update(win, id, { keyframes: {} });
  const [kf0, kf1] = [await changed(win, "base0", "kf0", 12), await changed(win, "base1", "kf1", 12)];
  check(`glow keyframes brighten it over time (${kf0.n} → ${kf1.n} px lit)`, kf1.n > 1.5 * kf0.n);
  await update(win, id, { glowEnabled: false });

  // An Effects style, then none.
  await grab(win, "unstyled");
  const yellow1 = await yellowPx();
  await settled(win, () => win.evaluate(async (id) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { textEffectOf } = await import("/src/lib/text-styles.ts");
    useClipStore.getState().updateClip(id, { textEffect: textEffectOf("pop") });
  }, id));
  await grab(win, "styled");
  const styled = await changed(win, "unstyled", "styled");
  const pop = (await yellowPx()) - yellow1;
  check(`an Effects style draws its layers (${styled.n} px changed, ${pop} more yellow px)`, styled.n > wide.n && pop > 200);
  await shot("ts6-style");
  await update(win, id, { textEffect: null });
  await grab(win, "unstyled2");
  const back = await changed(win, "unstyled", "unstyled2");
  check(`taking it off puts the text back (${back.n} px differ)`, back.n < 20);

  // Saved.
  await update(win, id, { letterSpacing: 2, glowEnabled: true, glowColor: "", moreStrokes: [{ color: "#ff00ff", width: 4, opacity: 50 }], fillGradient: { colors: ["#ffffff", "#ffd400"], angle: 90 } });
  const doc = await savedProject(win, udDir);
  const saved = doc.timeline.clips.find((c) => c.clipId === id);
  check("the saved project keeps the fields", saved?.letterSpacing === 2 && saved?.glowEnabled === true && saved?.moreStrokes?.length === 1 && saved?.fillGradient?.colors?.length === 2, JSON.stringify({ letterSpacing: saved?.letterSpacing, glow: saved?.glowEnabled, more: saved?.moreStrokes?.length }));
  await settled(win, () => win.evaluate(async (id) => (await import("/src/lib/clip.ts")).useClipStore.getState().removeClip(id), id));

  // Captions from the SRT fixture, on a track of their own.
  const srt = fs.readFileSync(fixture, "utf8");
  await seek(win, map, 0.5);
  await grab(win, "noCaption0");
  await seek(win, map, 2);
  await grab(win, "noCaption1");
  const imported = await settled(win, () => win.evaluate(async (srt) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const { useViewportStore } = await import("/src/lib/viewport.ts");
    const { parseCaptions, captionClips } = await import("/src/lib/captions.ts");
    const { textPreset } = await import("/src/lib/text-presets.ts");
    const fps = useControlsStore.getState().fps || 30;
    const { aspectRatio } = useViewportStore.getState();
    const canvas = { width: (600 * aspectRatio.width) / aspectRatio.height, height: 600 };
    const { cues, skipped } = parseCaptions(srt);
    const { timeline, clips } = captionClips(cues, { fps, canvas, makeId: () => crypto.randomUUID(), style: textPreset("caption").props });
    useClipStore.getState().addTimeline(timeline, -1);
    for (const c of clips) useClipStore.getState().addClip(c);
    window.__captionTrack = timeline.timelineId;
    return { cues: cues.length, skipped, clips: clips.map((c) => [c.startFrame / fps, c.endFrame / fps, c.text]) };
  }, srt));
  const got = await win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    return useClipStore.getState().clips.filter((c) => c.timelineId === window.__captionTrack).sort((a, b) => a.startFrame - b.startFrame).map((c) => [+(c.startFrame / fps).toFixed(3), +(c.endFrame / fps).toFixed(3), c.text]);
  });
  const near = (a, b) => Math.abs(a - b) < 0.6 / 24;
  check(`four captions on their own track with the file's timing ${JSON.stringify(got.map((c) => [c[0], c[1]]))}`, imported && got.length === 4 && near(got[0][0], 0.25) && near(got[0][1], 1.3) && near(got[1][0], 1.3) && near(got[2][0], 3) && near(got[3][1], 5.75) && got[1][2] === "A second one\nover two lines");
  await seek(win, map, 0.5);
  await grab(win, "caption0");
  await seek(win, map, 2);
  await grab(win, "caption1");
  const [c0, c1] = [await changed(win, "noCaption0", "caption0"), await changed(win, "noCaption1", "caption1")];
  check(`each caption shows at its time (${c0.n} and ${c1.n} px; the two-line one taller: ${c0.h} vs ${c1.h})`, c0.n > 100 && c1.n > 100 && c1.h > c0.h * 1.4);
  await shot("ts7-captions");

  // The track written back out as SRT: the same captions, on the frames they took.
  const out = await win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const { clipsToCues, writeSrt } = await import("/src/lib/captions.ts");
    const fps = useControlsStore.getState().fps || 30;
    return writeSrt(clipsToCues(useClipStore.getState().clips, fps, { timelineIds: [window.__captionTrack] }));
  });
  fs.writeFileSync(path.join(ctx.outDir, "captions-out.srt"), out);
  const blocks = out.trim().split(/\n\n/);
  // Each cue's times, to the millisecond, are the frames its clip took.
  const secs = (t) => t.split(/[:,]/).reduce((s, v, i) => s + +v * [3600, 60, 1, 0.001][i], 0);
  const times = blocks.map((b) => b.split("\n")[1].split(" --> ").map(secs));
  const same = times.length === got.length && times.every(([s, e], i) => Math.abs(s - got[i][0]) < 0.0011 && Math.abs(e - got[i][1]) < 0.0011);
  check(`the captions write back out as SRT (${blocks.length} cues on their clips' frames, the second "${blocks[1]?.split("\n").slice(2).join(" / ")}")`, same && blocks[1].endsWith("A second one\nover two lines"), JSON.stringify(times));
  return report();
};
