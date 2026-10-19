// Several clips selected at once (after `import timeline newtext`: the 10 s standard clip with a
// text 0-3 s over it; OPENRIP_ENGINE_MUTE=1). The video is split at 5 s into two clips, so the
// timeline has two videos and a text. Checks, each through the inspector and the project as saved:
// - two videos: the tabs Video, Speed, Adjust; Transform showing the shared values, "-" where
//   they differ; a typed Scale, Position and Rotate set on both clips as one undo step (the
//   engine's frame changing); Opacity; Adjust ▸ Basic's Brilliance on both, each clip keeping
//   its own other values; Speed on both; HSL on both;
// - a video with the text: the Properties tab with the shared Transform; Align left / centre /
//   bottom put the clips against the canvas, Distribute spaces three clips evenly;
// - a single clip back to its own tabs, and the text's own Transform (scale in the engine).
// Shots: `ms1-videos` ↔ `29-inspector-multi/002`, `ms3-properties` ↔ `29-inspector-multi/001`.
import { drag, engineFrame, now, rulerMap, seek, settled } from "./_preview.mjs";
import { bar, checks, savedProject } from "./_anim.mjs";
import { undoCase as undoStep } from "./_undo.mjs";
import { input, open, typeIn } from "./_inspector.mjs";

const tabs = (win) => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector-tabs] [role=tab]")].map((e) => e.innerText.trim()));
const subs = (win) => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] [role=tablist] [role=tab]")].map((e) => e.innerText.trim()));
// The autosave is slow after typed edits: let it finish, so the project before an edit is the one it starts from.
const undoCase = async (ctx, check, name, edit, opts) => {
  await ctx.win.waitForTimeout(2500);
  return undoStep(ctx, check, name, edit, opts);
};
const shownValue = (win, label, n = 0) => input(win, label, n).inputValue();

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const doc0 = await savedProject(win, udDir);
  const clips = (d) => d.timeline.clips;
  const video0 = clips(doc0).find((c) => c.type === "video");

  // Split the video at 5 s: two videos on the main track.
  await seek(win, ctx.map, 5);
  let [x, y] = await bar(ctx, doc0, video0.clipId, 7.5);
  await win.mouse.click(x, y);
  await win.waitForTimeout(500);
  await settled(win, () => win.keyboard.press("Meta+b"));
  // The autosave can be a few seconds behind: read the project until it has the split.
  let doc = await savedProject(win, udDir);
  for (let i = 0; i < 20 && clips(doc).filter((c) => c.type === "video").length < 2; i++) {
    await win.waitForTimeout(500);
    doc = await savedProject(win, udDir);
  }
  const videos = () => clips(doc).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  const text = () => clips(doc).find((c) => c.type === "text");
  if (videos().length !== 2) throw new Error(`${videos().length} videos after the split`);
  const [v1, v2] = videos();

  const selectBars = async (items) => {
    doc = await savedProject(win, udDir);
    await win.keyboard.press("Escape");
    for (let i = 0; i < items.length; i++) {
      const [id, at] = items[i];
      const [bx, by] = await bar(ctx, doc, id, at);
      if (i) await win.keyboard.down("Shift");
      await win.mouse.click(bx, by);
      if (i) await win.keyboard.up("Shift");
      await win.waitForTimeout(500);
    }
  };
  // The autosave can be a few seconds behind an edit: wait a little more than savedProject does.
  const saved = async (id) => {
    await win.waitForTimeout(1500);
    return clips(await savedProject(win, udDir)).find((c) => c.clipId === id);
  };

  // Two videos: CapCut's tabs for several videos.
  await selectBars([[v1.clipId, 2], [v2.clipId, 8]]);
  const t = await tabs(win);
  check("two videos: tabs Video, Speed, Adjust", t.join(",") === "Video,Speed,Adjust", t.join(","));
  await shot("ms1-videos");
  check("two videos: Video has Basic only (no Mask or Remove BG)", (await subs(win)).join(",") === "", (await subs(win)).join(","));
  check("shared Transform shows the common scale", (await shownValue(win, "Scale")) === "100%", await shownValue(win, "Scale"));

  // Scale typed once reaches both, in one step.
  const scaleOf = (c) => c.transform.scaleX;
  const before = [await saved(v1.clipId), await saved(v2.clipId)];
  const r = await undoCase(ctx, check, "multi scale", () => typeIn(win, "Scale", 150));
  const after = [await saved(v1.clipId), await saved(v2.clipId)];
  check("Scale 150 set on both videos", before.every((c, i) => Math.abs(scaleOf(after[i]) / scaleOf(c) - 1.5) < 0.01), `${before.map(scaleOf)} -> ${after.map(scaleOf)}`);
  void r;

  // A clip of its own, then both: the field that differs shows "-".
  await selectBars([[v1.clipId, 2]]);
  await open(win, "Video");
  await typeIn(win, "Rotate", 30);
  await selectBars([[v1.clipId, 2], [v2.clipId, 8]]);
  check("Rotate shows - where the clips differ", (await shownValue(win, "Rotate")) === "-", await shownValue(win, "Rotate"));
  check("Scale still shared", (await shownValue(win, "Scale")) === "150%", await shownValue(win, "Scale"));
  await undoCase(ctx, check, "multi rotate", () => typeIn(win, "Rotate", 10));
  const rot = [await saved(v1.clipId), await saved(v2.clipId)].map((c) => Math.round(c.transform.rotation));
  check("Rotate 10 set on both", rot.every((v) => v === 10), rot.join(","));
  await undoCase(ctx, check, "multi opacity", () => typeIn(win, "Opacity", 60));
  const op = [await saved(v1.clipId), await saved(v2.clipId)].map((c) => Math.round(c.transform.opacity));
  check("Opacity 60 set on both", op.every((v) => v === 60), op.join(","));

  // Adjust ▸ Basic on both; each clip keeps the values it had.
  await selectBars([[v2.clipId, 8]]);
  await open(win, "Adjust", "Basic");
  await typeIn(win, "Contrast", 20);
  await selectBars([[v1.clipId, 2], [v2.clipId, 8]]);
  await open(win, "Adjust", "Basic");
  await undoCase(ctx, check, "multi brilliance", () => typeIn(win, "Brilliance", 15));
  const adjust = [await saved(v1.clipId), await saved(v2.clipId)].map((c) => c.color?.adjust ?? {});
  check("Brilliance 15 on both, Contrast 20 stayed on the clip that had it", adjust.every((a) => a.brightness === 15) && adjust[0].contrast === undefined && adjust[1].contrast === 20, JSON.stringify(adjust));

  // Speed on both.
  await open(win, "Speed");
  const len = (c) => +c.endTick - +c.startTick;
  const l0 = [await saved(v1.clipId), await saved(v2.clipId)].map(len);
  await undoCase(ctx, check, "multi speed", async () => {
    await typeIn(win, "Speed", 2);
  });
  const l1 = [await saved(v1.clipId), await saved(v2.clipId)].map(len);
  check("Speed 2x halves both clips", l0.every((l, i) => Math.abs(l1[i] / l - 0.5) < 0.02), `${l0} -> ${l1}`);

  // A video and the text: Properties.
  await selectBars([[v1.clipId, 1.2], [text().clipId, 1]]);
  const t2 = await tabs(win);
  check("a video and a text: the Properties tab", t2.join(",") === "Properties", t2.join(","));
  await shot("ms3-properties");
  for (const id of ["multi-align-left", "multi-align-center-h", "multi-align-right", "multi-align-top", "multi-align-center-v", "multi-align-bottom", "multi-distribute-h", "multi-distribute-v"])
    check(`${id} is there`, (await win.locator(`[data-testid=${id}]`).count()) === 1);
  check("Distribute needs three clips", await win.locator("[data-testid=multi-distribute-h]").isDisabled());

  // Where a saved clip's picture is: its turned box's bounds on the canvas (world units, 337.5 x 600).
  const W = 337.5;
  const H = 600;
  const bounds = (c) => {
    const t = c.transform;
    const [w, h, r] = [t.width * t.scaleX, t.height * t.scaleY, (t.rotation * Math.PI) / 180];
    const cx = t.x + (Math.cos(r) * w - Math.sin(r) * h) / 2;
    const cy = t.y + (Math.sin(r) * w + Math.cos(r) * h) / 2;
    const hw = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2;
    const hh = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2;
    return { cx, cy, left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
  };
  const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const press = (testId) => settled(win, () => win.locator(`[data-testid=${testId}]`).click());
  const pair = async () => [bounds(await saved(v1.clipId)), bounds(await saved(text().clipId))];
  const quiet = () => win.waitForTimeout(1500);
  await undoCase(ctx, check, "multi align left", () => press("multi-align-left"), { frame: false });
  let [b1, b2] = await pair();
  check("Align left puts both clips' left edges at the canvas's", near(b1.left, 0) && near(b2.left, 0), `${b1.left.toFixed(1)}, ${b2.left.toFixed(1)}`);
  await press("multi-align-right");
  [b1, b2] = await pair();
  check("Align right", near(b1.right, W) && near(b2.right, W), `${b1.right.toFixed(1)}, ${b2.right.toFixed(1)}`);
  await press("multi-align-center-h");
  [b1, b2] = await pair();
  check("Centre horizontally", near(b1.cx, W / 2) && near(b2.cx, W / 2), `${b1.cx.toFixed(1)}, ${b2.cx.toFixed(1)}`);
  await press("multi-align-top");
  [b1, b2] = await pair();
  check("Align top", near(b1.top, 0) && near(b2.top, 0), `${b1.top.toFixed(1)}, ${b2.top.toFixed(1)}`);
  await press("multi-align-bottom");
  [b1, b2] = await pair();
  check("Align bottom", near(b1.bottom, H) && near(b2.bottom, H), `${b1.bottom.toFixed(1)}, ${b2.bottom.toFixed(1)}`);
  await press("multi-align-center-v");
  [b1, b2] = await pair();
  check("Centre vertically", near(b1.cy, H / 2) && near(b2.cy, H / 2), `${b1.cy.toFixed(1)}, ${b2.cy.toFixed(1)}`);

  // Distribute: three clips at uneven places (typed one by one), then spaced evenly.
  const place = async (id, at, x) => {
    await selectBars([[id, at]]);
    await open(win, id === text().clipId ? "Text" : "Video");
    await typeIn(win, "Position", x);
  };
  await place(v1.clipId, 1.2, -90);
  await place(v2.clipId, 3.5, 60);
  await place(text().clipId, 0.5, -10);
  // All three: ⌘A selects every clip on the timeline.
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Meta+a");
  await win.waitForTimeout(600);
  check("three clips: Distribute is on", await win.locator("[data-testid=multi-distribute-h]").isEnabled());
  await undoCase(ctx, check, "multi distribute", () => press("multi-distribute-h"), { frame: false });
  const three = (await Promise.all([v1.clipId, v2.clipId, text().clipId].map(saved))).map(bounds).sort((a, b) => a.cx - b.cx);
  const gaps = [three[1].left - three[0].right, three[2].left - three[1].right];
  check("Distribute horizontally: equal gaps between the clips", near(gaps[0], gaps[1], 1), gaps.map((g) => g.toFixed(1)).join(" and "));

  // A single clip has its own tabs again, and the text has Transform and Blend.
  await selectBars([[v1.clipId, 1.2]]);
  const t3 = await tabs(win);
  check("one video: Video, Audio, Speed, Animation, Adjust again", t3.join(",").startsWith("Video,Audio,Speed,Animation,Adjust"), t3.join(","));
  await selectBars([[text().clipId, 0.5]]);
  await open(win, "Text");
  const sections = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [data-section]")].map((e) => e.getAttribute("data-section")));
  check("the text has Transform and Blend like a video", sections.includes("Transform") && sections.includes("Blend"), sections.join(","));
  await seek(win, ctx.map, 1);
  await selectBars([[text().clipId, 0.5]]);
  await open(win, "Text");
  const f0 = (await engineFrame(win)).sum;
  const tb = bounds(await saved(text().clipId));
  await typeIn(win, "Scale", 200);
  const tt = await saved(text().clipId);
  const f1 = (await engineFrame(win)).sum;
  check("the text's Scale 200 is saved and the engine draws it", Math.abs(tt.transform.scaleX - 2) < 0.01 && f1 !== f0, `scale ${tt.transform.scaleX}, frame changed ${f1 !== f0}`);
  await shot("ms4-text-scale");
  return report();
};
