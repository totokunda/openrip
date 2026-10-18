// The Text tab's new fields on a converted CapCut caption (after `capcut`, with the renderer's
// dev server as for `keyframes`), through the store: the draft's spacing shows in CapCut's
// panel units (Line 0 for CapCut's 0.02), its glow off and no Effects style of the app's; then
// Character 5 and a glow change the engine's frame, and putting the fields back gives the
// draft's frame again (the importer applies only what differs from the draft).
import { engineFrame, grab, diff, rulerMap, seek, settled } from "./_preview.mjs";
import { checks } from "./_anim.mjs";

const update = (win, id, fields) =>
  settled(win, () => win.evaluate(async ({ id, fields }) => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    useClipStore.getState().updateClip(id, fields);
  }, { id, fields }));

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const map = (ctx.map = await rulerMap(win));
  const caption = await win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    const c = useClipStore.getState().clips.filter((c) => c.type === "text").sort((a, b) => a.startFrame - b.startFrame)[0];
    if (!c) return null;
    return { id: c.clipId, at: (c.startFrame + Math.min(15, (c.endFrame - c.startFrame) / 2)) / fps, letterSpacing: c.letterSpacing, lineSpacing: c.lineSpacing, glowEnabled: c.glowEnabled, textEffect: c.textEffect ?? null, base: c.engine?.base ?? {} };
  });
  if (!caption) throw new Error("no text clip in the draft");
  check(`the draft's spacing in CapCut's panel units (Character ${caption.letterSpacing}, Line ${caption.lineSpacing})`, typeof caption.letterSpacing === "number" && typeof caption.lineSpacing === "number" && "lineSpacing" in caption.base);
  check(`no glow, no app style (${caption.glowEnabled}, ${JSON.stringify(caption.textEffect)})`, caption.glowEnabled === false && (caption.textEffect === null || caption.textEffect.id === ""));
  await seek(win, map, caption.at);
  await grab(win, "draft");
  await update(win, caption.id, { letterSpacing: caption.letterSpacing + 5 });
  await grab(win, "spaced");
  const spaced = await diff(win, "draft", "spaced");
  check(`Character +5 changes the caption (${spaced.n} px)`, spaced.n > 100);
  await update(win, caption.id, { glowEnabled: true, glowColor: "#ff00ff", glowIntensity: 50 });
  await grab(win, "glow");
  const glow = await diff(win, "spaced", "glow");
  check(`a glow lights it (${glow.n} px)`, glow.n > spaced.n);
  await shot("cts1-glow");
  await update(win, caption.id, { letterSpacing: caption.letterSpacing, glowEnabled: false, glowColor: caption.base.glowColor ?? "", glowIntensity: caption.base.glowIntensity ?? 30 });
  await grab(win, "back");
  const back = await diff(win, "draft", "back");
  const { w, h } = await engineFrame(win);
  check(`putting them back gives the draft's frame (${back.n} of ${w * h} px differ)`, back.n < 0.001 * w * h);
  return report();
};
