// Transitions and clip animations set through the store with lib/animations.ts on the first
// video or photo clip (after `import timeline`), and the engine's frames checked. The step
// imports the renderer's modules, so it needs the renderer from its dev server (as
// `keyframes`): `npx vite --port 5199` in packages/renderer and the session with
// MODE=development VITE_DEV_SERVER_URL=http://localhost:5199.
//
// The clip is split at 3 s and its right half darkened (brightness −60), so the halves differ.
// Checks: a 1 s Mix at the cut goes from the left half's lightness to the right's across its
// window (the right half shown ahead of its start); at the cut a Push left shows the left
// half on the left and the right half on the right, and a Wipe right the other way round;
// Fade In and Fade Out darken the first and last half second to about half; a split of the
// left half keeps its In on its left part and leaves the frames as they were; a Swing combo
// turns the picture and spans the part it's on; the saved project keeps the fields.
import { engineFrame, grab, diff, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

// Mean lightness of the engine frame's left and right halves.
const halves = (win) => win.evaluate(() => {
  const c = document.getElementById("openrip-engine-frame");
  const t = document.createElement("canvas");
  t.width = c.width; t.height = c.height;
  const g = t.getContext("2d");
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, t.width, t.height).data;
  const sums = [0, 0], counts = [0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const side = (i / 4) % t.width < t.width / 2 ? 0 : 1;
    sums[side] += (d[i] + d[i + 1] + d[i + 2]) / 765;
    counts[side]++;
  }
  return [sums[0] / counts[0], sums[1] / counts[1]];
});

// Set fields on a clip through the store and wait for the engine to redraw.
const update = (win, id, fields) =>
  settled(win, () => win.evaluate(async ({ id, fields }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    useClipStore.getState().updateClip(id, fields);
  }, { id, fields }));

// The fields lib/animations.ts makes for a built-in (`kind` "transition" or an animation's).
const made = (win, id, kind, type, opts = {}) => win.evaluate(async ({ id, kind, type, opts }) => {
  const a = await import("/src/lib/animations.ts");
  const { useClipStore } = await import("/src/lib/clip.ts");
  const { useControlsStore } = await import("/src/lib/control.ts");
  if (kind === "transition") return a.transitionOf(type, opts);
  const clip = useClipStore.getState().clips.find((c) => c.clipId === id);
  return a.animationOf(clip, kind, type, { ...opts, fps: useControlsStore.getState().fps || 30 });
}, { id, kind, type, opts });

// The parts of the clip of `asset`, in timeline order.
const parts = (win, asset) => win.evaluate(async (asset) => {
  const { useClipStore } = await import("/src/lib/clip.ts");
  const { useControlsStore } = await import("/src/lib/control.ts");
  const fps = useControlsStore.getState().fps || 30;
  return useClipStore.getState().clips
    .filter((c) => (c.type === "video" || c.type === "image") && c.assetId === asset)
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((c) => ({ id: c.clipId, start: c.startFrame / fps, end: c.endFrame / fps, fps, animationIn: c.animationIn ?? null, animationOut: c.animationOut ?? null, animationCombo: c.animationCombo ?? null, transitionOut: c.transitionOut ?? null }));
}, asset);

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const map = (ctx.map = await rulerMap(win));
  // Split at 3 s and darken the right half.
  const first = await win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    const clip = useClipStore.getState().clips.find((c) => c.type === "video" || c.type === "image");
    if (!clip) throw new Error("no video or photo clip");
    useClipStore.getState().splitClip(clip.startFrame + 3 * fps, clip.clipId);
    return clip.assetId;
  });
  let [a, b] = await parts(win, first);
  await update(win, b.id, { brightness: -60 });
  const cut = a.end;
  const step = 1 / a.fps;
  // Times on frames.
  const at = (s) => Math.round(s / step) * step;
  await seek(win, map, at(cut - 0.7));
  const lightA = (await engineFrame(win)).light;
  await seek(win, map, at(cut + 0.7));
  const lightB = (await engineFrame(win)).light;
  check(`the right half is darker (${lightA.toFixed(3)} → ${lightB.toFixed(3)})`, lightB < lightA - 0.05);

  // Mix: lightness between the halves', by how far through the 1 s window.
  await update(win, a.id, { transitionOut: await made(win, a.id, "transition", "mix", { duration: 1 }) });
  const mixed = [];
  for (const s of [-0.3, 0, 0.3]) {
    await seek(win, map, at(cut + s));
    mixed.push((await engineFrame(win)).light);
  }
  await shot("tr1-mix");
  const want = [0.2, 0.5, 0.8].map((p) => lightA + p * (lightB - lightA));
  check(`a Mix goes from one half to the other ${JSON.stringify(mixed.map((v) => +v.toFixed(3)))} ~ ${JSON.stringify(want.map((v) => +v.toFixed(3)))}`, mixed.every((v, i) => Math.abs(v - want[i]) < 0.25 * (lightA - lightB)) && mixed[0] > mixed[1] && mixed[1] > mixed[2]);

  // Push left and Wipe right at the cut: each half of the frame from a different clip.
  await update(win, a.id, { transitionOut: await made(win, a.id, "transition", "push", { duration: 1, params: { direction: "left" } }) });
  await seek(win, map, at(cut));
  const push = await halves(win);
  await shot("tr2-push");
  await update(win, a.id, { transitionOut: await made(win, a.id, "transition", "wipe", { duration: 1, params: { direction: "right" } }) });
  const wipe = await halves(win);
  await shot("tr3-wipe");
  await update(win, a.id, { transitionOut: null });
  const none = await halves(win);
  check(`a Push left shows the outgoing clip on the left at the cut ${JSON.stringify(push.map((v) => +v.toFixed(3)))}`, push[0] > push[1] + 0.05 && push[0] > none[0] + 0.05);
  check(`a Wipe right shows the incoming clip on the left at the cut ${JSON.stringify(wipe.map((v) => +v.toFixed(3)))}`, wipe[1] > wipe[0] + 0.05 && Math.abs(wipe[0] - none[0]) < 0.03);

  // Fade In on the left half, Fade Out on the right one (1 s each).
  await update(win, a.id, { animationIn: await made(win, a.id, "in", "fade_in", { duration: 1 }) });
  await update(win, b.id, { animationOut: await made(win, b.id, "out", "fade_out", { duration: 1 }) });
  const light = async (s) => {
    await seek(win, map, at(s));
    return (await engineFrame(win)).light;
  };
  const [inHalf, inFull] = [await light(a.start + 0.5), await light(a.start + 1.5)];
  const [outFull, outHalf] = [await light(b.end - 1.5), await light(b.end - 0.5)];
  check(`Fade In: about half as light halfway through (${(inHalf / inFull).toFixed(2)})`, inHalf / inFull > 0.35 && inHalf / inFull < 0.65);
  check(`Fade Out: about half as light halfway through (${(outHalf / outFull).toFixed(2)})`, outHalf / outFull > 0.35 && outHalf / outFull < 0.65);
  await shot("tr4-fades");

  // A split of the left half at 1.5 s: the In stays on its left part, and the frames with it.
  await seek(win, map, at(a.start + 0.5));
  await grab(win, "before0");
  await seek(win, map, at(a.start + 2.2));
  await grab(win, "before1");
  await settled(win, () => win.evaluate(async ({ id, frame }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    useClipStore.getState().splitClip(frame, id);
  }, { id: a.id, frame: Math.round((a.start + 1.5) * a.fps) }));
  const split = await parts(win, first);
  check(`the split keeps the In on the left part only ${JSON.stringify(split.map((p) => p.animationIn?.type ?? null))}`, split.length === 3 && split[0].animationIn?.type === "fade_in" && split[1].animationIn === null && split[2].animationOut?.type === "fade_out");
  await win.waitForTimeout(1000);
  await seek(win, map, at(a.start + 0.5));
  await grab(win, "after0");
  await seek(win, map, at(a.start + 2.2));
  await grab(win, "after1");
  const d0 = await diff(win, "before0", "after0"), d1 = await diff(win, "before1", "after1");
  const { w, h } = await engineFrame(win);
  check(`the frames are as before the split (${d0.n} and ${d1.n} pixels differ)`, d0.n < 0.01 * w * h && d1.n < 0.01 * w * h);

  // A Swing combo on the first part turns its picture: the frame a quarter of the way through
  // changes; the combo spans that part.
  [a] = split;
  await update(win, a.id, { animationIn: null });
  const peak = at(a.start + (a.end - a.start) / 8);
  await seek(win, map, peak);
  await grab(win, "still");
  await update(win, a.id, { animationCombo: await made(win, a.id, "combo", "swing") });
  await grab(win, "swing");
  const turned = await diff(win, "still", "swing");
  const frame = await engineFrame(win);
  check(`a Swing turns the picture (${turned.n} of ${frame.w * frame.h} pixels changed)`, turned.n > 0.2 * frame.w * frame.h);
  const combo = (await parts(win, first))[0].animationCombo;
  check(`the combo spans its part (${combo?.duration} s)`, Math.abs((combo?.duration ?? 0) - (a.end - a.start)) < 1e-6);
  await shot("tr5-swing");

  const doc = await savedProject(win, udDir);
  const saved = doc.timeline.clips.filter((c) => c.animationIn || c.animationOut || c.animationCombo);
  check("the saved project keeps the animations", saved.length === 2 && saved.some((c) => c.animationCombo?.type === "swing") && saved.some((c) => c.animationOut?.type === "fade_out"), `${saved.length} clips`);
  return report();
};
