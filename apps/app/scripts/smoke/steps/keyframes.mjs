// Keyframes set through the store with lib/keyframes.ts on the first video or photo clip
// (after `import timeline`), and the engine's frames checked over time. The step imports the
// renderer's modules, so it needs the renderer from its dev server: run `npx vite --port 5199`
// in packages/renderer and the session with MODE=development
// VITE_DEV_SERVER_URL=http://localhost:5199.
//
// Keys: opacity 100 → 0 over the clip's first 2 s (linear), and the box's centre 300 world
// units to the right with CapCut's ease in-out. Checks that the picture darkens as the
// opacity falls and changes at every sample; that an edit at the playhead on a keyed
// property sets a key there (CapCut's rule); that a split gives both halves keys with one at
// the cut and leaves the frames as they were (to a lightness of 0.002); and that the saved
// project keeps the keys.
import { engineFrame, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

const TIMES = [0, 0.5, 1, 1.5, 2];

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const map = (ctx.map = await rulerMap(win));
  const set = await settled(win, () =>
    win.evaluate(async () => {
      const { useClipStore } = await import("/src/lib/clip.ts");
      const { useControlsStore } = await import("/src/lib/control.ts");
      const kf = await import("/src/lib/keyframes.ts");
      const clip = useClipStore.getState().clips.find((c) => c.type === "video" || c.type === "image");
      if (!clip) throw new Error("no video or photo clip");
      const fps = useControlsStore.getState().fps || 30;
      const centre = kf.propertyValue(clip, "position");
      let k = kf.setKeyframe(undefined, "opacity", 0, 100);
      k = kf.setKeyframe(k, "opacity", 2 * fps, 0);
      k = kf.setKeyframe(k, "position", 0, centre, "easeInOut");
      k = kf.setKeyframe(k, "position", 2 * fps, [centre[0] + 300, centre[1]]);
      useClipStore.getState().updateClip(clip.clipId, { keyframes: k });
      window.__kfClip = clip.clipId;
      return { id: clip.clipId, fps, start: clip.startFrame / fps };
    }),
  );
  check("the engine redrew after the keys were set", set !== false);
  const { start, fps } = await win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    const c = useClipStore.getState().clips.find((c) => c.clipId === window.__kfClip);
    return { start: c.startFrame / fps, fps };
  });
  const frames = [];
  for (const s of TIMES) {
    await seek(win, map, start + s);
    frames.push(await engineFrame(win));
  }
  await shot("k1-keyed");
  const light = frames.map((f) => +f.light.toFixed(4));
  check(`the picture darkens as the opacity falls ${JSON.stringify(light)}`, light.every((l, i) => i === 0 || l < light[i - 1]), JSON.stringify(light));
  check("the frame changes at every sample", new Set(frames.map((f) => f.sum)).size === frames.length);
  check("at 2 s the clip is gone (opacity 0)", light[light.length - 1] < 0.01, String(light[light.length - 1]));

  // CapCut's rule: an edit at the playhead (1 s) on a keyed property sets a key there.
  const rule = await win.evaluate(async (fps) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const kf = await import("/src/lib/keyframes.ts");
    const s = useClipStore.getState();
    const c = s.clips.find((c) => c.clipId === window.__kfClip);
    s.updateClip(c.clipId, kf.editProperty(c, "opacity", c.startFrame + fps, 100));
    const after = useClipStore.getState().clips.find((x) => x.clipId === c.clipId);
    return { opacity: after.keyframes.opacity.map((k) => [k.frame, k.value]), field: after.transform?.opacity };
  }, fps);
  check(`an edit at the playhead sets a key there ${JSON.stringify(rule.opacity)}`, rule.opacity.length === 3 && rule.opacity[1][0] === fps && rule.opacity[1][1] === 100);
  await seek(win, map, start + 1);
  const bumped = await engineFrame(win);
  check("the frame at 1 s shows the new key (brighter)", bumped.light > frames[2].light, `${bumped.light} vs ${frames[2].light}`);

  // A split at 0.5 s keeps the frames (the curve cut in two moves less than a pixel): both
  // halves have keys, one at the cut.
  const before = [];
  for (const s of [0.25, 0.75, 1.25]) {
    await seek(win, map, start + s);
    before.push((await engineFrame(win)).light);
  }
  const halves = await win.evaluate(async (fps) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const s = useClipStore.getState();
    const c = s.clips.find((c) => c.clipId === window.__kfClip);
    const cut = c.startFrame + Math.round(fps / 2);
    s.splitClip(cut, c.clipId);
    const parts = useClipStore.getState().clips.filter((x) => x.assetId === c.assetId && x.type === c.type).sort((a, b) => a.startFrame - b.startFrame);
    return parts.map((p) => ({ start: p.startFrame, opacity: p.keyframes?.opacity?.map((k) => k.frame), position: p.keyframes?.position?.length ?? 0 }));
  }, fps);
  check(`the split gives each half keys, one at the cut ${JSON.stringify(halves)}`, halves.length === 2 && halves[0].opacity?.at(-1) === Math.round(fps / 2) && halves[1].opacity?.[0] === 0 && halves[1].position > 0);
  await win.waitForTimeout(1500);
  const after = [];
  for (const s of [0.25, 0.75, 1.25]) {
    await seek(win, map, start + s);
    after.push((await engineFrame(win)).light);
  }
  check("the frames around the cut are as before", after.every((v, i) => Math.abs(v - before[i]) < 0.002), `${after.map((v) => v.toFixed(4))} vs ${before.map((v) => v.toFixed(4))}`);

  const doc = await savedProject(win, udDir);
  const saved = doc.timeline.clips.filter((c) => c.keyframes && Object.keys(c.keyframes).length);
  check("the saved project keeps the keys", saved.length === 2, `${saved.length} clips with keys`);
  return report();
};
