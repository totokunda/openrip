// Snapping (after import timeline newtext: the text 0–3 s on a track over the clip). The text
// dragged so an edge comes a few pixels from a point lands on it exactly, with the guide line
// drawn while it's dragged:
//   playhead  its start to the playhead at 5 s (and with N, Auto snapping off, it doesn't)
//   marker    its end to a marker at 8 s
//   edge      its end to the end of the video on the track below
//   trim      its right edge dragged near the playhead ends on it
import { drag, rulerMap, seek, settled } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { clipsOn, doc, fpsOf, handleX, isOn, key, rowY, sec } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const textOf = (d) => clipsOn(d, d.timeline.tracks.find((t) => t.type === "text").timelineId)[0];
  const videoOf = (d) => clipsOn(d, d.timeline.tracks.find((t) => t.type === "media").timelineId).at(-1);
  const OFF = 3; // pixels short of the point (snapping reaches 6)

  // Bright pixels in a column of the timeline's canvases, under its tracks (where nothing but
  // the guide line draws).
  const guideAt = (x) =>
    win.evaluate((x) => {
      const cs = [...document.querySelectorAll("canvas")].filter((c) => {
        const b = c.getBoundingClientRect();
        return b.y > innerHeight * 0.3 && b.width > innerWidth * 0.75;
      });
      let n = 0;
      for (const c of cs) {
        const b = c.getBoundingClientRect();
        const k = c.width / b.width;
        const g = c.getContext("2d");
        const y0 = Math.round((b.height - 40) * k);
        const d = g.getImageData(Math.round((x - b.x) * k) - 2, y0, 5, Math.round(30 * k)).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200 && d[i + 3] > 100) n++;
      }
      return n;
    }, x);

  // Drag the text's bar by `ds` seconds plus `px` pixels, checking the guide line at `guideX`
  // before letting go.
  const dragText = async (d, ds, px, guideX) => {
    const t = textOf(d);
    const y = await rowY(ctx, d, t.timelineId);
    const x0 = map.x(sec(d, (t.s + t.e) / 2));
    const x1 = map.x(sec(d, (t.s + t.e) / 2) + ds) + px;
    let guide = null;
    await settled(win, async () => {
      await win.mouse.move(x0, y);
      await win.mouse.down();
      await win.mouse.move((x0 + x1) / 2, y, { steps: 8 });
      await win.mouse.move(x1, y, { steps: 8 });
      await win.waitForTimeout(200);
      if (guideX != null) guide = await guideAt(guideX);
      await win.mouse.up();
    });
    return guide;
  };

  let d = await doc(ctx);
  const fps = fpsOf(d);
  const t0 = textOf(d);

  // The playhead: the start lands on 5 s.
  await seek(win, map, 5);
  let guide = 0;
  const r = await undoCase(ctx, check, "move snapped to the playhead", async () => {
    guide = await dragText(d, 5 - sec(d, t0.s), OFF, map.x(5));
  });
  d = await doc(ctx);
  check("a dragged clip's start snaps to the playhead", r.ok && textOf(d).s === 5 * fps, `start ${textOf(d).s}, playhead ${5 * fps}`);
  check("the guide line shows while it's snapped", guide > 3, `${guide} bright pixels at the playhead under the tracks`);
  await key(win, "Meta+z");

  // N turns snapping off: the same drag lands where it's dropped.
  await key(win, "n");
  check("N turns Auto snapping off", !(await isOn(win, "Auto snapping")));
  d = await doc(ctx);
  await dragText(d, 5 - sec(d, textOf(d).s), OFF);
  d = await doc(ctx);
  check("with snapping off it doesn't snap", textOf(d).s !== 5 * fps, `start ${textOf(d).s}`);
  await key(win, "Meta+z");
  await key(win, "n");

  // A marker at 8 s: the end lands on it.
  await seek(win, map, 8);
  await key(win, "m");
  await seek(win, map, 1);
  d = await doc(ctx);
  let t = textOf(d);
  await dragText(d, 8 - sec(d, t.e), -OFF);
  d = await doc(ctx);
  check("a dragged clip's end snaps to a marker", textOf(d).e === 8 * fps, `end ${textOf(d).e}, marker ${d.timeline.markers?.[0]?.frame}`);
  await key(win, "Meta+z");

  // The video's end on the track below.
  d = await doc(ctx);
  t = textOf(d);
  const v = videoOf(d);
  await dragText(d, sec(d, v.e - t.e), -OFF);
  d = await doc(ctx);
  check("a dragged clip's end snaps to a clip's edge on another track", textOf(d).e === v.e, `end ${textOf(d).e}, video end ${v.e}`);
  await key(win, "Meta+z");

  // Trim: the right edge near the playhead (2 s) ends on it.
  await seek(win, map, 2);
  d = await doc(ctx);
  t = textOf(d);
  const y = await rowY(ctx, d, t.timelineId);
  await win.mouse.click(map.x(sec(d, t.s) + 0.6), y);
  await win.waitForTimeout(400);
  const hx = await handleX(win, map.x(sec(d, t.e)), y);
  const tr = await undoCase(ctx, check, "trim snapped to the playhead", () =>
    settled(win, () => drag(win, hx, y, map.x(2) + OFF, y)),
  );
  d = await doc(ctx);
  check("a trimmed edge snaps to the playhead", tr.ok && textOf(d).e === 2 * fps, `end ${textOf(d).e}`);
  await ctx.shot("tl-snap");
  return report();
};
