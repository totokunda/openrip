// What the new timeline's clips show of their media (after `import timeline tl2mediaprep tl2on`
// on PULSE.mp4: a photo 0-5 s, PULSE.mp4 5-19 s on the main track, TONE.wav on an audio track).
// Reads the canvas's own account (window.__openripTimelineMedia: what each clip was drawn with) and
// the page shots:
//   thumbs    the video's tiles all drawn from their own frames, the photo's tiles repeated
//   sound     the audio clip's bars and the video's sound band's, the volume line
//   trim      Delete left at 11 s: the bars of what's left are the bars of that part of the sound
//   scroll    a scroll away and back, and a zoom out and in, fetch no tile already cached
// With OLD=1 (no tl2on) only the scroll and zoom run, counting the decoder's work, to compare.
import { rulerMap, seek, timelineRect } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { doc, fpsOf, key } from "./_timeline.mjs";

const media = (win, id) => win.evaluate((id) => window.__openripTimelineMedia?.media(id) ?? null, id);
const stats = (win) => win.evaluate(() => window.__openripTimelineMedia?.stats() ?? null);
const decodes = (win) => win.evaluate(() => window.__decodes ?? 0);
const clips = (win) =>
  win.evaluate(() => window.__openripTimeline.layout().clips.map((b) => ({ id: b.id, type: b.clip.type, x: b.x, w: b.w, y: b.y, h: b.h, start: b.clip.startFrame, end: b.clip.endFrame })));

/** Waits until no tile is queued and the stats stop changing. */
const quiet = async (win, ms = 1500, max = 30000) => {
  let last = "";
  let since = Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    await win.waitForTimeout(250);
    const s = await stats(win);
    const sig = s ? `${s.tilesFetched}/${s.queued}/${s.jobs}` : String(await decodes(win));
    if (sig !== last || (s && s.queued)) {
      last = sig;
      since = Date.now();
    } else if (Date.now() - since >= ms) return;
  }
};

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const old = !!process.env.OLD;
  // Counts the packets the browser's decoder is given: the work a scroll or zoom makes.
  await win.evaluate(() => {
    if (window.__decodes !== undefined || typeof VideoDecoder === "undefined") return;
    window.__decodes = 0;
    const d = VideoDecoder.prototype.decode;
    VideoDecoder.prototype.decode = function (...a) {
      window.__decodes++;
      return d.apply(this, a);
    };
  });
  let tl = await timelineRect(win);
  const wheel = async (dx, dy, meta = false) => {
    await win.mouse.move(tl.x + tl.w / 2, tl.y + 60);
    if (meta) await win.keyboard.down("Meta");
    await win.mouse.wheel(dx, dy);
    if (meta) await win.keyboard.up("Meta");
    await win.waitForTimeout(300);
  };
  const count = async () => (old ? await decodes(win) : (await stats(win)).tilesFetched);

  if (!old) {
    await quiet(win);
    const cs = await clips(win);
    const video = cs.find((c) => c.type === "video");
    const photo = cs.find((c) => c.type === "image");
    const audio = cs.find((c) => c.type === "audio");
    const [v, p, a] = await Promise.all([media(win, video.id), media(win, photo.id), media(win, audio.id)]);
    await shot("tl2media-1");
    check("the video's tiles are all drawn from their own frames", v.thumbs && v.thumbs.tiles > 5 && v.thumbs.exact === v.thumbs.tiles, JSON.stringify(v.thumbs));
    check("the photo's band is tiled", p.thumbs && p.thumbs.tiles > 3 && p.thumbs.exact === p.thumbs.tiles, JSON.stringify(p.thumbs));
    check("the video's own sound has bars in its bottom band", v.sound && v.sound.maxBar > 2 && v.sound.maxBar <= v.sound.height, `max ${v.sound?.maxBar} of ${v.sound?.height}`);
    check("the audio clip has bars, taller than the band's", a.sound && a.sound.maxBar > (v.sound?.maxBar ?? 0), `max ${a.sound?.maxBar} of ${a.sound?.height}`);
    check("the volume line is drawn", a.sound?.line.length >= 2 && v.sound?.line.length >= 2);
    check("the photo's band is silent", !p.sound);
    check("the video's chips are its name and length", v.chips?.length === 2 && /PULSE/.test(v.chips[0]), JSON.stringify(v.chips));
    // The bars as they are now, kept to compare after a trim.
    const before = { bars: v.sound.heights, ppf: v.sound.pxPerFrame };
    const d0 = await doc(ctx);
    const fps = fpsOf(d0);
    ctx.map = await rulerMap(win);
    await seek(win, ctx.map, 11);
    await win.mouse.click(tl.x + video.x + 400, tl.y + video.y + video.h / 2);
    await win.waitForTimeout(300);
    await key(win, "q");
    await quiet(win);
    const v2 = (await clips(win)).find((c) => c.type === "video");
    const m2 = await media(win, v2.id);
    // What was 6 s into the clip is now at its start: the same bars, 6 s of pixels earlier.
    const shift = 6 * fps * before.ppf;
    const old0 = new Map(before.bars.map((b) => [Math.round(b.x), b.h]));
    let n = 0;
    let err = 0;
    for (const b of m2.sound.heights) {
      const x = Math.round(b.x + shift);
      const h = old0.get(x) ?? old0.get(x - 1) ?? old0.get(x + 1);
      if (h === undefined) continue;
      n++;
      err += Math.abs(h - b.h);
    }
    check("after Delete left the bars stay on the sound", n > 20 && err / n < 1.5, `${n} bars compared, mean off ${(err / Math.max(1, n)).toFixed(2)} px`);
    await shot("tl2media-trim");
    await key(win, "Meta+z");
    await quiet(win);
  }

  // Scroll and zoom.
  tl = await timelineRect(win);
  await win.mouse.click(tl.x + 600, tl.y + 12);
  const log = [];
  const step = async (name, fn) => {
    const c0 = await count();
    await fn();
    await quiet(win, 1200);
    const c1 = await count();
    log.push(`${name}: ${c1 - c0}`);
    return c1 - c0;
  };
  await step("zoom in x4", async () => { for (let i = 0; i < 4; i++) await win.keyboard.press("Meta+="); });
  await step("scroll right", () => wheel(600, 0));
  await shot("tl2media-zoomed");
  const away = await step("scroll back", () => wheel(-600, 0));
  const again = await step("scroll right again", () => wheel(600, 0));
  await step("scroll back", () => wheel(-600, 0));
  const out = await step("zoom out x4", async () => { for (let i = 0; i < 4; i++) await win.keyboard.press("Meta+-"); });
  const inn = await step("zoom in x4 again", async () => { for (let i = 0; i < 4; i++) await win.keyboard.press("Meta+="); });
  if (!old) {
    check("scrolling over what's been drawn fetches nothing", away === 0 && again === 0, `${away}, ${again}`);
    check("zooming back to a zoom already drawn fetches nothing", inn === 0, String(inn));
    await shot("tl2media-zoomed2");
    const s = await stats(win);
    log.push(`store: ${s.tiles} tiles, ${(s.bytes / 1e6).toFixed(1)} MB`);
  }
  return `${old ? "old" : "new"} ${log.join("; ")}\n  ${report()}`;
};
