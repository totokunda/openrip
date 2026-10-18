// A project made before the draw tool went (after import timeline): a drawing clip written
// into the saved project (a thick red stroke across the canvas, 0–4 s) still opens, the engine
// draws it, and it can be selected, moved on the timeline and deleted, each undone and redone.
import path from "node:path";
import { goHome, rulerMap, seek, settled } from "./_preview.mjs";
import { checks, clipsWhere, savedProject, select, bar } from "./_anim.mjs";
import { press, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, shot, udDir, fs } = ctx;
  const { check, report } = checks();
  const name = await win.locator("[data-testid=project-name]").inputValue();
  const file = path.join(udDir, "projects-json", "project-1.json");

  // Away from the project, then its file given a drawing (as an older app saved one).
  await goHome(win);
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(3000);
  await goHome(win);
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  const trackId = "legacy-draw-track";
  p.timeline.tracks.unshift({ timelineId: trackId, timelineHeight: 32, timelineWidth: 0, timelineY: 0, timelinePadding: 50, type: "draw", muted: false, hidden: false });
  p.timeline.clips.push({
    clipId: "legacy-draw",
    type: "draw",
    timelineId: trackId,
    clipPadding: 24,
    startTick: "0",
    endTick: "4000000",
    trimStartTick: "0",
    trimEndTick: "0",
    lines: [
      {
        lineId: "l1",
        tool: "brush",
        points: [40, 150, 120, 300, 260, 420],
        stroke: "#ff0000",
        strokeWidth: 24,
        opacity: 100,
        smoothing: 0.5,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 100 },
      },
    ],
  });
  fs.writeFileSync(file, JSON.stringify(p));
  await win.locator("[data-testid=project-card]").filter({ has: win.getByText(name, { exact: true }) }).first().locator("button[title^='Open ']").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(6000);

  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 1);
  let doc = await savedProject(win, udDir);
  check("the drawing clip opens with the project", clipsWhere(doc, (c) => c.type === "draw").length === 1);
  // The engine draws the red stroke.
  const red = await win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) n++;
    return n;
  });
  check("the engine draws the drawing", red > 200, String(red));
  await shot("ld1-drawing");

  // Selected by its bar; moved by a drag on the timeline.
  await select(ctx, doc, "legacy-draw", 3);
  const [x, y] = await bar(ctx, doc, "legacy-draw", 3);
  await undoCase(ctx, check, "the drawing moved 1 s later", () => settled(win, async () => {
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + ctx.map.pps * 0.5, y, { steps: 6 });
    await win.mouse.move(x + ctx.map.pps, y, { steps: 6 });
    await win.mouse.up();
  }), { frame: false });
  doc = await savedProject(win, udDir);
  const moved = clipsWhere(doc, (c) => c.type === "draw")[0];
  check("it starts about 1 s later", moved && Math.abs(+moved.startTick / 1e6 - 1) < 0.15, moved?.startTick);
  // Deleted (selected again, then ⌫).
  await select(ctx, doc, "legacy-draw", 3);
  await undoCase(ctx, check, "the drawing deleted", () => press(win, "Backspace"));
  doc = await savedProject(win, udDir);
  check("after ⇧⌘Z it's gone", clipsWhere(doc, (c) => c.type === "draw").length === 0);
  return report();
};
