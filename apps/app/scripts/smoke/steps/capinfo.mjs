// What an opened project has, for writing a step against it: the ruler's mapping, its tracks
// and the clips with their Animation tab fields, as saved.
import fs from "node:fs";
import path from "node:path";
import { rulerMap, timelineRect } from "./_preview.mjs";
export default async (ctx) => {
  const { win, udDir, outDir } = ctx;
  const map = (ctx.map = await rulerMap(win));
  const tl = await timelineRect(win);
  await win.waitForTimeout(1500);
  const dir = path.join(udDir, "projects-json");
  const files = fs.readdirSync(dir).filter((f) => /^project-.*\.json$/.test(f)).map((f) => path.join(dir, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const doc = JSON.parse(fs.readFileSync(files[0], "utf8"));
  const sec = (t) => (+t / 1e6).toFixed(2);
  const lines = [`ruler: x(0)=${map.x(0).toFixed(1)} pps=${map.pps.toFixed(1)} y=${map.y.toFixed(0)}; timeline top ${tl.y.toFixed(0)}`];
  for (const t of doc.timeline.tracks) lines.push(`track ${t.timelineId.slice(0, 8)} ${t.type} y=${t.timelineY} h=${t.timelineHeight}`);
  for (const c of doc.timeline.clips) {
    const extra = { animationIn: c.animationIn, captionStyle: c.captionStyle, spokenWords: c.spokenWords, transitionOut: c.transitionOut };
    lines.push(`clip ${c.clipId.slice(0, 8)} ${c.type} track ${c.timelineId.slice(0, 8)} ${sec(c.startTick)}-${sec(c.endTick)} ${(c.text ?? "").slice(0, 24)} ${JSON.stringify(extra)}`);
  }
  fs.writeFileSync(path.join(outDir, "capinfo.txt"), lines.join("\n"));
  return `${doc.timeline.clips.length} clips; see capinfo.txt`;
};
