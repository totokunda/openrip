// The Transitions tab and transitions on cuts, through the UI (after import timeline; the clip
// is split at 5 s, later at 8 s too):
// - the tab's column lists the categories under Transitions, its cards every transition the
//   engine draws (translib covers the shader ones), a hovered card its +;
// - + with the first half selected puts White Flash on the cut: saved, selected (its inspector
//   with its name and 0.5 s), the engine's frame white at the cut and partly so before it,
//   unchanged outside it; ⌘Z / ⇧⌘Z;
// - its duration: 1 s reaches half a second before the cut; the slider stops at the shorter clip;
// - a click on its marker selects it again; its right side dragged lengthens it;
// - Push dragged from its card onto the cut replaces it, then its direction changes the frame;
// - right-click ▸ Delete takes it off (⌘Z brings it back), as does ⌫ on the selected marker;
// - + with the last clip selected goes on the cut before it; Apply to all gives every cut of the
//   track the same one, in one step.
import { clickSplit, diff, drag, grab, rulerMap, seek, settled } from "./_preview.mjs";
import {
  addTransition,
  checks,
  deleteTransition,
  duration,
  markerAt,
  openTransitionCard,
  pickTransition,
  rowOf,
  savedClips,
  savedProject,
  select,
  setDuration,
  transitionName,
  transitionsOffered,
} from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";

const TIMES = [4.5, 4.6, 4.875, 5, 5.4];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const map = (ctx.map ??= await rulerMap(win));
  const ROW = await rowOf(ctx, "video");
  const { check, report } = checks();
  const at = async (s, name) => {
    await seek(win, map, s);
    await grab(win, name);
  };
  const doc = () => savedProject(win, udDir);
  const videos = async () => (await savedClips(win, udDir)).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  const types = (v) => v.map((c) => c.transitionOut?.type ?? "-").join(",");
  for (const s of TIMES) await at(s, `none@${s}`);

  // Two clips meeting at 5 s.
  await seek(win, map, 5);
  await win.mouse.click(map.x(2), ROW);
  await win.waitForTimeout(600);
  await settled(win, () => clickSplit(win));
  let v = await videos();
  check("split in two at 5 s", v.length === 2 && +v[0].endTick === 5e6, v.map((c) => `${c.startTick}-${c.endTick}`).join());

  // The tab.
  await win.locator("[data-testid=assets-tab-transitions]").click();
  await win.waitForTimeout(500);
  const sections = (await win.locator("[data-testid=assets] nav[aria-label=Sections] [data-testid^=assets-section-]").allInnerTexts()).map((s) => s.trim());
  check("its column: Favorites, then the twelve categories", sections.join() === "Favorites,Basic,Slide,Wipe,Mask,Pattern,Camera,Blur,Light,Glitch,Distortion,3D,Overlay", sections.join());
  const offered = await transitionsOffered(win);
  const classics = ["Mix", "Black Fade", "White Flash", "White Fade", "Pull in", "Pull out", "Blur", "Slide", "Push", "Wipe", "Circle", "Spin"];
  check("its cards: the engine's twelve classics (not Blink) and the hundred shader ones", classics.every((n) => offered.includes(n)) && !offered.includes("Blink") && offered.length === 112, `${offered.length}: ${offered.slice(0, 14).join()}`);
  const flashCard = await openTransitionCard(win, "White Flash");
  await flashCard.hover();
  await win.waitForTimeout(300);
  check("a hovered card shows its +", await win.locator("[data-testid=transition-add-white_flash]").isVisible());
  await shot("t1-tab");

  // + with the first half selected.
  await select(ctx, await doc(), v[0].clipId, 2);
  await undoCase(ctx, check, "White Flash by its +", () => addTransition(win, "White Flash"));
  v = await videos();
  check("saved on the first half", types(v) === "white_flash,-", types(v));
  check("its inspector shows White Flash, 0.5 s", (await transitionName(win)) === "White Flash" && (await duration(win))?.value === 0.5, `${await transitionName(win)} ${JSON.stringify(await duration(win))}`);
  await shot("t2-flash-inspector");
  await at(5, "a@5");
  const cut = await diff(win, "none@5", "a@5");
  await at(4.875, "a@4.875");
  const quarter = await diff(win, "none@4.875", "a@4.875");
  await at(4.5, "a@4.5");
  const before = (await diff(win, "none@4.5", "a@4.5")).n;
  await at(5.4, "a@5.4");
  const after = (await diff(win, "none@5.4", "a@5.4")).n;
  check("the engine: white at the cut, partly before it, nothing outside", cut.light > 0.99 && quarter.n > 0 && quarter.light < 0.95 && before === 0 && after === 0, `light ${cut.light.toFixed(2)}, ${quarter.light.toFixed(2)}; changed ${before}, ${after}`);

  // Its duration, in its inspector.
  if (!(await pickTransition(ctx, await doc(), v[0].clipId))) check("a click on its marker selects it", false);
  else check("a click on its marker selects it", (await transitionName(win)) === "White Flash");
  await setDuration(win, 1);
  v = await videos();
  check("duration 1 s, saved", v[0].transitionOut?.duration === 1, JSON.stringify(v[0].transitionOut));
  await at(4.6, "a@4.6");
  check("duration: the flash starts half a second before the cut", (await diff(win, "none@4.6", "a@4.6")).n > 0);
  await pickTransition(ctx, await doc(), v[0].clipId);
  await setDuration(win, 9);
  const big = await duration(win);
  check("the slider stops at the shorter clip (5 s)", big?.value === 5 && big?.max === 5, JSON.stringify(big));
  await setDuration(win, 0.5);

  // Its right side dragged half a second along lengthens it by a second.
  await pickTransition(ctx, await doc(), v[0].clipId);
  {
    const [x, y] = await markerAt(ctx, await doc(), v[0].clipId);
    const edge = x + (0.5 * map.pps) / 2 - 2;
    await settled(win, () => drag(win, edge, y, edge + map.pps / 2, y));
    v = await videos();
    const d = v[0].transitionOut?.duration ?? 0;
    check("its side dragged lengthens it", Math.abs(d - 1.5) < 0.15, `${d} s`);
  }

  // Push dragged onto the cut, then its direction.
  {
    const card = await openTransitionCard(win, "Push");
    const box = await card.boundingBox();
    const [x, y] = await markerAt(ctx, await doc(), v[0].clipId);
    await settled(win, () => drag(win, box.x + box.width / 2, box.y + box.height / 2, x, y));
    v = await videos();
    check("Push dragged onto the cut replaces it", types(v) === "push,-" && v[0].transitionOut?.params?.direction === "left", JSON.stringify(v[0].transitionOut));
    await shot("t3-push-dropped");
    // Off the cut (at it, both sides of one shot show the same moment, so a push either way
    // looks alike).
    await at(4.6, "push-left@4.6");
    const pushed = await diff(win, "none@4.6", "push-left@4.6");
    check("Push draws before the cut", pushed.n > 1000, `changed ${pushed.n}`);
    await pickTransition(ctx, await doc(), v[0].clipId);
    await settled(win, () => win.locator("[data-testid=transition-direction-right]").click());
    v = await videos();
    await at(4.6, "push-right@4.6");
    const turned = (await diff(win, "push-left@4.6", "push-right@4.6")).n;
    check("direction right: saved, another frame", v[0].transitionOut?.params?.direction === "right" && turned > 1000, `${JSON.stringify(v[0].transitionOut)}; changed ${turned}`);
  }

  // Right-click ▸ Delete, undone and redone; ⌫ on the selected marker.
  await undoCase(ctx, check, "right-click ▸ Delete", async () => {
    const [x, y] = await markerAt(ctx, await doc(), v[0].clipId);
    await win.mouse.click(x, y, { button: "right" });
    await win.waitForTimeout(400);
    await settled(win, () => win.locator("[data-testid=menu-delete]").click());
  }, { frame: false });
  v = await videos();
  check("⇧⌘Z left it deleted", types(v) === "-,-", types(v));
  await select(ctx, await doc(), v[0].clipId, 2);
  await addTransition(win, "White Flash");
  await deleteTransition(win);
  v = await videos();
  await at(5, "a@5");
  check("⌫ deletes the selected one; nothing drawn at the cut", types(v) === "-,-" && (await diff(win, "none@5", "a@5")).n === 0, types(v));

  // Three clips: + on the last one goes on the cut before it; Apply to all.
  await seek(win, map, 8);
  await win.mouse.click(map.x(10), ROW);
  await win.waitForTimeout(600);
  await settled(win, () => clickSplit(win));
  v = await videos();
  await select(ctx, await doc(), v[2].clipId, 10);
  await addTransition(win, "Mix");
  v = await videos();
  check("+ on the last clip: on the cut before it", v.length === 3 && types(v) === "-,mix,-", types(v));
  await undoCase(ctx, check, "Apply to all", () => settled(win, () => win.locator("[data-testid=transition-apply-all]").click()), { frame: false });
  v = await videos();
  check("Apply to all: every cut of the track", types(v) === "mix,mix,-", types(v));
  await shot("t4-apply-all");
  return report();
};
