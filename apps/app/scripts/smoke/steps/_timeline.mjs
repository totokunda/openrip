// Timeline editing helpers: the saved project's tracks and clips in frames, the main track,
// the timeline's toolbar buttons, and dragging a clip's bar or edge.
import { drag, settled, timelineRect } from "./_preview.mjs";
import { savedProject } from "./_anim.mjs";

export const fpsOf = (doc) => doc.settings?.fps || 24;
// A clip's start and end in frames (the file keeps µs ticks, truncated).
export const framesOf = (doc, c) => ({ ...c, s: Math.round((+c.startTick * fpsOf(doc)) / 1e6), e: Math.round((+c.endTick * fpsOf(doc)) / 1e6) });
// The main track: the lowest video track.
export const mainTrack = (doc) => [...doc.timeline.tracks].reverse().find((t) => t.type === "media");
export const clipsOn = (doc, trackId) =>
  doc.timeline.clips.filter((c) => c.timelineId === trackId && !c.hidden).map((c) => framesOf(doc, c)).sort((a, b) => a.s - b.s);
export const mainClips = (doc) => clipsOn(doc, mainTrack(doc)?.timelineId);
// Whether clips run end to end from 0.
export const packed = (clips) => clips.every((c, i) => c.s === (i === 0 ? 0 : clips[i - 1].e));
export const layout = (clips) => clips.map((c) => `${c.s}-${c.e}`).join(" ");

export const doc = (ctx) => savedProject(ctx.win, ctx.udDir);

// A toolbar button by its title ("Delete left", "Main track magnet", …; the shortcut after it
// in the tooltip isn't needed).
export const button = (win, title) => win.locator(`[title^="${title}"]`).first();
export const isOn = async (win, title) => (await button(win, title).getAttribute("aria-checked")) === "true";

// Seconds of a frame, for the ruler map.
export const sec = (doc, f) => f / fpsOf(doc);

// Where a track's row is on screen (its middle).
export const rowY = async (ctx, doc, trackId) => {
  const tl = await timelineRect(ctx.win);
  const t = doc.timeline.tracks.find((x) => x.timelineId === trackId);
  return tl.y + 27 + t.timelineY + t.timelineHeight / 2;
};

// Drag a clip's bar from `fromS` seconds (on its row) to `toS` seconds on the row at `toY`.
export const dragClip = async (ctx, d, clip, fromS, toS, toY) => {
  const y = await rowY(ctx, d, clip.timelineId);
  await settled(ctx.win, () => drag(ctx.win, ctx.map.x(fromS), y, ctx.map.x(toS), toY ?? y));
};

// Where a selected clip's trim handle is: the white run (handle and outline) nearest `x` on
// the row at `y`, found in the timeline's canvases. The ruler's mapping can be a pixel or two
// off, and the handle is 3 px wide.
export const handleX = (win, x, y) =>
  win.evaluate(({ x, y }) => {
    let best = null;
    for (const c of document.querySelectorAll("canvas")) {
      const b = c.getBoundingClientRect();
      if (b.y < innerHeight * 0.3 || b.width < innerWidth * 0.6 || y < b.y || y > b.y + b.height) continue;
      const k = c.width / b.width;
      const x0 = Math.round((x - 8 - b.x) * k);
      const d = c.getContext("2d").getImageData(x0, Math.round((y - b.y) * k), Math.round(16 * k), 1).data;
      for (let i = 0; i < d.length / 4; i++) {
        if (d[i * 4] > 235 && d[i * 4 + 1] > 235 && d[i * 4 + 2] > 235 && d[i * 4 + 3] > 200) {
          const at = b.x + (x0 + i) / k;
          if (best == null || Math.abs(at - x) < Math.abs(best - x)) best = at;
        }
      }
    }
    return best ?? x - 1;
  }, { x, y });

// Presses with nothing focused, then the picture settled.
export const key = async (win, keys) => {
  await win.evaluate(() => document.activeElement?.blur?.());
  await settled(win, () => win.keyboard.press(keys), { timeout: 2500 });
};
