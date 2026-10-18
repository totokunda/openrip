// The keyframe diamonds on a selected clip's bar (after import timeline), driven through the
// timeline. The keys are set through the store with lib/keyframes.ts (the inspector's diamonds
// are another panel's), so the step needs the renderer's dev server, as `keyframes` does:
// `npx vite --port 5199` in packages/renderer and the session with MODE=development
// VITE_DEV_SERVER_URL=http://localhost:5199. The diamonds are found in the timeline's Konva
// stage by name.
//
// Keys: opacity 100 at 0 s and 0 at 2 s, scale 1 at 1 s and 1.5 at 2 s: diamonds at 0, 1 and
// 2 s, none before the clip is selected. A click on the one at 1 s puts the playhead there; the
// one at 2 s dragged to 3 s moves both keys there (the frame at 2 s brighter; ⌘Z / ⇧⌘Z); the
// right-click menu ticks Linear, then Ease in sets the ease after the key at 1 s (another frame
// at 1.5 s) and Delete keyframe takes it away.
import { drag, engineFrame, now, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, clipsWhere, savedClips, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";

/** The timeline's diamonds: their centres on screen, left to right. */
const diamonds = (win) =>
  win.evaluate(() => {
    const stage = (window.Konva?.stages ?? []).find((s) => s.container().closest("[data-testid=timeline]"));
    if (!stage) return [];
    const box = stage.container().getBoundingClientRect();
    return stage
      .find(".keyframe-diamond")
      .map((n) => n.getAbsolutePosition())
      .map((p) => ({ x: box.x + p.x, y: box.y + p.y }))
      .sort((a, b) => a.x - b.x);
  });

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = (ctx.map ??= await rulerMap(win));
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  const fps = doc.settings?.fps || 24;
  await settled(win, () =>
    win.evaluate(async (id) => {
      const { useClipStore } = await import("/src/lib/clip.ts");
      const { useControlsStore } = await import("/src/lib/control.ts");
      const kf = await import("/src/lib/keyframes.ts");
      const fps = useControlsStore.getState().fps || 30;
      let k = kf.setKeyframe(undefined, "opacity", 0, 100);
      k = kf.setKeyframe(k, "opacity", 2 * fps, 0);
      k = kf.setKeyframe(k, "scale", fps, [1, 1]);
      k = kf.setKeyframe(k, "scale", 2 * fps, [1.5, 1.5]);
      useClipStore.getState().updateClip(id, { keyframes: k });
      useControlsStore.getState().clearSelection();
    }, video.clipId),
  );
  const keys = async () => (await savedClips(win, udDir)).find((c) => c.clipId === video.clipId).keyframes;
  check("no diamonds while the clip isn't selected", (await diamonds(win)).length === 0);
  await seek(win, map, 5);
  await select(ctx, doc, video.clipId, 6);
  let d = await diamonds(win);
  check("three diamonds on the selected clip, at 0, 1 and 2 s", d.length === 3 && d.every((p, i) => Math.abs(p.x - map.x(i)) < 3), JSON.stringify(d.map((p) => Math.round(p.x - map.x(0)))));
  await shot("k1-diamonds");

  // A click puts the playhead on it.
  await win.mouse.click(d[1].x, d[1].y);
  await win.waitForTimeout(500);
  check("a click on the one at 1 s puts the playhead there", (await now(win)) === 1, String(await now(win)));

  // The one at 2 s dragged to 3 s (the playhead away from it: its line would take the press).
  await seek(win, map, 2);
  const at2 = (await engineFrame(win)).light;
  await seek(win, map, 5);
  await select(ctx, await savedProject(win, udDir), video.clipId, 6);
  d = await diamonds(win);
  await undoCase(ctx, check, "a diamond dragged", () => settled(win, () => drag(win, d[2].x, d[2].y, d[2].x + map.pps, d[2].y)), { frame: false });
  let k = await keys();
  check("its keys moved to 3 s", k.opacity?.map((x) => x.frame).join() === `0,${3 * fps}` && k.scale?.map((x) => x.frame).join() === `${fps},${3 * fps}`, JSON.stringify({ o: k.opacity?.map((x) => x.frame), s: k.scale?.map((x) => x.frame) }));
  await seek(win, map, 2);
  check("the frame at 2 s brighter (the fade is slower)", (await engineFrame(win)).light > at2 + 0.02, `${at2}`);

  // Right-click the one at 1 s: the ease, then Delete keyframe.
  await seek(win, map, 1.5);
  const at15 = (await engineFrame(win)).sum;
  await seek(win, map, 5);
  await select(ctx, await savedProject(win, udDir), video.clipId, 6);
  d = await diamonds(win);
  await win.mouse.click(d[1].x, d[1].y, { button: "right" });
  await win.waitForTimeout(400);
  const ticked = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=menu-ease-]")].filter((b) => !b.querySelector("svg.invisible")).map((b) => b.innerText.trim()));
  check("its menu ticks Linear", ticked.join() === "Linear", ticked.join());
  await shot("k2-diamond-menu");
  await settled(win, () => win.locator("[data-testid=menu-ease-easeIn]").click());
  k = await keys();
  check("Ease in: the key at 1 s eased", k.scale?.[0]?.ease === "easeIn", JSON.stringify(k.scale?.[0]));
  await seek(win, map, 1.5);
  check("Ease in: another frame at 1.5 s", (await engineFrame(win)).sum !== at15);
  await select(ctx, await savedProject(win, udDir), video.clipId, 6);
  d = await diamonds(win);
  await win.mouse.click(d[1].x, d[1].y, { button: "right" });
  await win.waitForTimeout(400);
  await settled(win, () => win.locator("[data-testid=menu-delete-keyframe]").click());
  k = await keys();
  check("Delete keyframe: the scale key at 1 s gone", k.scale?.map((x) => x.frame).join() === `${3 * fps}`, JSON.stringify(k.scale));
  check("two diamonds left", (await diamonds(win)).length === 2);

  // The keyframe graph (⌥K) on the opacity's span from 0 to 3 s, the playhead at 1 s.
  await seek(win, map, 1);
  const before = (await engineFrame(win)).sum;
  await select(ctx, await savedProject(win, udDir), video.clipId, 6);
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Alt+k");
  await win.waitForTimeout(500);
  const graph = win.locator("[data-testid=keyframe-graph]");
  check("⌥K opens the graph on the opacity", (await graph.count()) === 1 && (await win.locator("[data-testid=keyframe-graph-property]").inputValue()) === "opacity");
  await shot("k3-graph");
  await settled(win, () => win.locator("[data-testid=keyframe-curve-easeOut]").click());
  k = await keys();
  const eased = (await engineFrame(win)).sum;
  check("Ease out from its row: saved, another frame", k.opacity?.[0]?.ease === "easeOut" && eased !== before, JSON.stringify(k.opacity?.[0]));
  const h = await win.locator("[data-testid=keyframe-handle-out]").boundingBox();
  await undoCase(ctx, check, "a handle dragged", () => settled(win, () => drag(win, h.x + h.width / 2, h.y + h.height / 2, h.x + h.width / 2 + 30, h.y + h.height / 2 + 25)));
  k = await keys();
  const curve = k.opacity?.[0]?.ease;
  check("the handle drag saves a curve of its own", typeof curve === "object" && curve?.out && curve?.in, JSON.stringify(curve));
  await shot("k4-graph-custom");
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Alt+k");
  await win.waitForTimeout(400);
  check("⌥K again closes it", (await graph.count()) === 0);
  return report();
};
