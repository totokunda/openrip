// After `keyframes` and `reopen`: the reopened project's clips still have their keys (from
// the saved file) and the engine draws them (the picture moves, and at 2 s the opacity has
// reached 0). Same dev-server setup as `keyframes`.
import { engineFrame, rulerMap, seek } from "./_preview.mjs";
import { checks } from "./_anim.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  const map = (ctx.map = await rulerMap(win));
  const clips = await win.evaluate(async () => {
    const { useClipStore } = await import("/src/lib/clip.ts");
    const { useControlsStore } = await import("/src/lib/control.ts");
    const fps = useControlsStore.getState().fps || 30;
    return useClipStore
      .getState()
      .clips.filter((c) => c.keyframes && Object.keys(c.keyframes).length)
      .map((c) => ({ start: c.startFrame / fps, props: Object.keys(c.keyframes).sort(), opacity: c.keyframes.opacity?.map((k) => [k.frame, k.value]) }));
  });
  check(`both halves have their keys back ${JSON.stringify(clips)}`, clips.length === 2 && clips.every((c) => c.props.join() === "opacity,position"));
  const frames = [];
  for (const s of [0, 0.25, 2]) {
    await seek(win, map, s);
    frames.push(await engineFrame(win));
  }
  check(`the engine draws them: moving, then gone (lightness ${frames.map((f) => f.light.toFixed(3))})`, frames[0].sum !== frames[1].sum && frames[2].light < 0.01);
  return report();
};
