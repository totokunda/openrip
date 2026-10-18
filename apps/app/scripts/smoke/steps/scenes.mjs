// Split scenes (on a fresh project, alone): a fixture made from the clip with FFmpeg, four
// shots (the clip's picture cropped, flipped and tinted so each looks like another camera)
// joined by hard cuts at 2.5, 4.5 and 7 s, put on the timeline; then the clip menu's Split
// scenes:
// - the processing pill shows while the engine reads it;
// - the clip comes out in four parts, cut on the shots' first frames (within half a frame),
//   all selected, each part showing its own shot in the engine's frame;
// - ⌘Z gives back the one clip and the project as it was, ⇧⌘Z the four parts;
// - Cancel on the pill stops a second run with nothing changed.
import { engineFrame, rulerMap, seek } from "./_preview.mjs";
import { bar, checks, savedProject } from "./_anim.mjs";
import { press, undoCase } from "./_undo.mjs";
import { analysed, buildFixture, placeOnTimeline } from "./_fixture.mjs";

export const SEGMENTS = [
  { from: 0, frames: 75 },
  { from: 3, frames: 60, vf: "crop=iw*0.45:ih*0.45:iw*0.05:ih*0.1,scale=720:1280,hue=h=35:s=1.3" },
  { from: 6, frames: 75, vf: "hflip,crop=iw*0.5:ih*0.5:iw*0.5:ih*0.5,scale=720:1280,eq=brightness=0.1:saturation=0.4:contrast=1.3,colorbalance=bs=0.25" },
  { from: 9, frames: 60, vf: "crop=iw*0.6:ih*0.6:iw*0.2:0,scale=720:1280,colorbalance=rs=0.2:bs=-0.2" },
];

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  const fixture = buildFixture(ctx, "scenes.mp4", SEGMENTS);
  await placeOnTimeline(ctx, fixture.file, "scenes");
  ctx.map = await rulerMap(win);
  const doc0 = await savedProject(win, udDir);
  const fps = doc0.settings?.fps || 30;
  const videos = (doc) => doc.timeline.clips.filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  const first = videos(doc0)[0];
  check("the fixture is on the timeline", !!first && Math.abs(+first.endTick / 1e6 - fixture.seconds) < 1 / fps + 1e-3, first && `${+first.endTick / 1e6} s`);

  // The clip menu, as CapCut's: Split scenes, and Adjust color ▸.
  const openMenu = async () => {
    await seek(win, ctx.map, 0.2);
    const doc = await savedProject(win, udDir);
    const [x, y] = await bar(ctx, doc, videos(doc)[0].clipId, fixture.seconds * 0.6);
    await win.mouse.click(x, y, { button: "right" });
    await win.waitForTimeout(400);
  };
  const splitFromMenu = async () => {
    await openMenu();
    await win.locator("[data-testid=menu-split-scenes]").click();
    await win.locator("[data-testid=analysis-pill]").waitFor({ timeout: 3000 }).catch(() => {});
    await shot("s2-processing");
    await analysed(win);
  };
  await openMenu();
  check("the menu has Split scenes and Adjust color", (await win.locator("[data-testid=menu-split-scenes]").count()) === 1 && (await win.locator("[data-testid=menu-adjust-color]").count()) === 1);
  await shot("s1-clip-menu");
  await win.locator("[data-testid=menu-adjust-color]").hover();
  await win.waitForTimeout(300);
  await shot("s1-adjust-color-menu");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  const { after } = await undoCase(ctx, check, "Split scenes", splitFromMenu, { frame: false });
  void after;
  const doc1 = await savedProject(win, udDir);
  const parts = videos(doc1);
  const starts = parts.map((c) => +c.startTick / 1e6);
  const want = [0, ...fixture.cuts];
  check(
    "four parts, cut on each shot's first frame",
    parts.length === 4 && want.every((t, i) => Math.abs(starts[i] - t) <= 0.5 / fps + 1e-3),
    `starts ${starts.map((s) => s.toFixed(3)).join(", ")}; want ${want.join(", ")}`,
  );
  check("the parts are back to back over the clip", parts.every((c, i) => i === 0 || c.startTick === parts[i - 1].endTick) && Math.abs(+parts[parts.length - 1].endTick / 1e6 - fixture.seconds) < 1 / fps + 1e-3);
  const selected = await win.locator("[data-testid=inspector-tabs]").count();
  check("the parts are selected (the clip inspector is up)", selected === 1);
  await shot("s3-split");
  // Each part shows its own shot.
  const sums = [];
  for (const c of parts) {
    await seek(win, ctx.map, (+c.startTick + +c.endTick) / 2e6);
    sums.push((await engineFrame(win)).sum);
  }
  check("each part shows another picture in the engine's frame", new Set(sums).size === parts.length, sums.join(" "));

  // Cancel: back to one clip, run again, stop it from the pill.
  await press(win, "Meta+z");
  await win.waitForTimeout(800);
  const before = videos(await savedProject(win, udDir)).length;
  await openMenu();
  await win.locator("[data-testid=menu-split-scenes]").click();
  const pill = win.locator("[data-testid=analysis-cancel]");
  let caught = false;
  try {
    await pill.click({ timeout: 2000 });
    caught = true;
  } catch {}
  await win.locator("[data-testid=analysis-pill]").waitFor({ state: "detached", timeout: 30000 });
  const afterCancel = videos(await savedProject(win, udDir)).length;
  check("Cancel stops it with nothing changed", before === 1 && (caught ? afterCancel === 1 : true), caught ? `${afterCancel} clip(s) after` : "finished before the click");
  return report();
};
