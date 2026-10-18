// Auto adjust, Color match and Make colors consistent (on a fresh project, alone): a fixture
// made from the clip with FFmpeg, its first 4 s as shot and the next 4 s dark and warm, put on
// the timeline and split in two at 4 s (A natural, B dark and warm). Then:
// - Auto adjust on B (Adjust tab): the panel lists the sliders it set, the project has them, the
//   engine's frame changes; Intensity 50 halves them; ⌘Z / ⇧⌘Z; off puts the frame back;
// - Color match on A with B as the reference: A's frame moves towards B's colours (the mean
//   colour at least halfway), the project keeps the match; Intensity 0 gives back A's own
//   frame; ⌘Z / ⇧⌘Z; off;
// - the project inspector's Project tab ▸ Make colors consistent with the playhead on B: A is
//   matched to B (one step: ⌘Z takes it off, ⇧⌘Z puts it back), B isn't; off takes it off.
import { engineFrame, rulerMap, seek, tab } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { press, undoCase } from "./_undo.mjs";
import { analysed, buildFixture, distance, frameMeans, placeOnTimeline } from "./_fixture.mjs";

const SEGMENTS = [
  { from: 0.5, frames: 120 },
  { from: 5, frames: 120, vf: "eq=brightness=-0.12:contrast=0.85:saturation=1.35,colorbalance=rs=0.18:gs=0.03:bs=-0.18:rm=0.12:bm=-0.12" },
];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const fixture = buildFixture(ctx, "looks.mp4", SEGMENTS);
  await placeOnTimeline(ctx, fixture.file, "looks");
  ctx.map = await rulerMap(win);
  const videos = (doc) => doc.timeline.clips.filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  // Split at 4 s with the toolbar's split (nothing selected: the main track's clip).
  await seek(win, ctx.map, 4);
  await win.locator("[data-testid=tool-split]").click();
  await win.waitForTimeout(800);
  let doc = await savedProject(win, udDir);
  let [a, b] = videos(doc);
  check("two clips, A then B, cut at 4 s", videos(doc).length === 2 && Math.abs(+b.startTick / 1e6 - 4) < 0.05, videos(doc).map((c) => +c.startTick / 1e6).join(", "));
  const colorOf = async (id) => videos(await savedProject(win, udDir)).find((c) => c.clipId === id)?.color ?? {};
  const meansAt = async (s) => {
    await seek(win, ctx.map, s);
    return frameMeans(win);
  };
  const [aT, bT] = [2, 6];
  const bOwn = await meansAt(bT);
  const aOwn = await meansAt(aT);
  check("B looks darker and warmer than A", bOwn[0] - bOwn[2] > aOwn[0] - aOwn[2] + 5, `A ${aOwn.map(Math.round)} B ${bOwn.map(Math.round)}`);

  // Auto adjust on B.
  await seek(win, ctx.map, bT);
  await select(ctx, doc, b.clipId, 7.5);
  await tab(win, "Adjust");
  await shot("c1-adjust-tab");
  const bFrame0 = (await engineFrame(win)).sum;
  const autoOn = async () => {
    await win.locator("[data-testid=auto-adjust-on]").click();
    await analysed(win);
  };
  await undoCase(ctx, check, "Auto adjust", autoOn);
  let color = await colorOf(b.clipId);
  const values = color.auto?.values ?? {};
  const set = Object.entries(values).filter(([, v]) => v);
  check("Auto adjust set sliders from B's statistics", set.length > 0 && set.every(([k, v]) => color.adjust?.[k] === v), JSON.stringify(values));
  check("B is brightened (it was darkened)", (values.brightness ?? 0) > 0 || (values.whites ?? 0) > 0 || (values.blacks ?? 0) < 0, JSON.stringify(values));
  const rows = await win.locator("[data-testid=auto-adjust-body] [data-testid^=auto-]").count();
  check("the panel lists the sliders it set", rows === set.length, `${rows} rows`);
  check("the engine's frame changed", (await engineFrame(win)).sum !== bFrame0);
  await shot("c2-auto-adjust");
  // Intensity 50.
  const intensity = win.locator("[data-testid=auto-adjust-body] input").first();
  await intensity.fill("50");
  await intensity.press("Enter");
  await win.waitForTimeout(600);
  color = await colorOf(b.clipId);
  check("Intensity 50 halves what it set", color.auto?.intensity === 50 && set.every(([k, v]) => color.adjust?.[k] === Math.round(v * 0.5)), JSON.stringify(color.adjust));
  // Off.
  await win.locator("[data-testid=auto-adjust-on]").click();
  await win.waitForTimeout(800);
  color = await colorOf(b.clipId);
  check("off: the sliders and the frame come back", !color.auto && Object.keys(color.adjust ?? {}).length === 0 && (await engineFrame(win)).sum === bFrame0, JSON.stringify(color));

  // Color match on A, B the reference.
  doc = await savedProject(win, udDir);
  await seek(win, ctx.map, aT);
  await select(ctx, doc, a.clipId, 3.5);
  await tab(win, "Adjust");
  await win.locator("[data-testid=color-match-on]").click();
  await win.waitForTimeout(400);
  await shot("c3-color-match-pick");
  const matchTo = async () => {
    await win.locator("[data-testid=color-match-reference]").click();
    await win.waitForTimeout(300);
    await win.locator(`[data-testid=reference-option][data-clip-id="${b.clipId}"]`).click();
    await analysed(win);
  };
  await undoCase(ctx, check, "Color match", matchTo);
  color = await colorOf(a.clipId);
  check("A keeps the match, B its reference", color.match?.ref?.clipId === b.clipId && color.match?.intensity === 100, JSON.stringify(color.match?.ref));
  const aMatched = await frameMeans(win);
  check(
    "A's frame moves towards B's colours",
    distance(aMatched, bOwn) < 0.5 * distance(aOwn, bOwn),
    `A ${aOwn.map(Math.round)} -> ${aMatched.map(Math.round)}, B ${bOwn.map(Math.round)}; ${distance(aOwn, bOwn).toFixed(1)} -> ${distance(aMatched, bOwn).toFixed(1)}`,
  );
  await shot("c4-color-match");
  const mIntensity = win.locator("[data-testid=color-match-body] input").first();
  await mIntensity.fill("0");
  await mIntensity.press("Enter");
  await win.waitForTimeout(800);
  check("Intensity 0 gives back A's own frame", distance(await frameMeans(win), aOwn) < 1, (await frameMeans(win)).map(Math.round).join(","));
  await win.locator("[data-testid=color-match-on]").click();
  await win.waitForTimeout(800);
  check("off: no match", !(await colorOf(a.clipId)).match);

  // Make colors consistent from the project inspector, the playhead on B.
  await seek(win, ctx.map, bT);
  await win.locator("[data-testid=project-tab-project]").click();
  await win.waitForTimeout(400);
  await shot("c5-project-tab");
  const consistent = async () => {
    await win.locator("[data-testid=make-colors-consistent-on]").click();
    await analysed(win);
  };
  await undoCase(ctx, check, "Make colors consistent", consistent, { frame: false });
  const [ca, cb] = [await colorOf(a.clipId), await colorOf(b.clipId)];
  check("A matched to B, B left as it is", ca.match?.consistent === true && ca.match?.ref?.clipId === b.clipId && !cb.match, JSON.stringify({ a: ca.match?.ref, b: cb.match }));
  await shot("c6-consistent");
  const aConsistent = await meansAt(aT);
  check("A's frame moves towards B's colours", distance(aConsistent, bOwn) < 0.5 * distance(aOwn, bOwn), `${distance(aOwn, bOwn).toFixed(1)} -> ${distance(aConsistent, bOwn).toFixed(1)}`);
  await win.locator("[data-testid=project-tab-project]").click().catch(() => {});
  await win.locator("[data-testid=make-colors-consistent-on]").click();
  await win.waitForTimeout(800);
  check("off: the matches come off", !(await colorOf(a.clipId)).match && distance(await meansAt(aT), aOwn) < 1);
  // The Details tab is still there.
  await win.locator("[data-testid=project-tab-details]").click();
  await win.waitForTimeout(300);
  check("the Details tab shows the project's path", /Path:/.test(await win.locator("[data-testid=inspector]").innerText()));
  await press(win, "Escape");
  return report();
};
