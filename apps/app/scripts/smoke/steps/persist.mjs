// What the Animation tab shows for the project's animated clips (up to four: an In animation,
// a caption style or a transition) and the engine's frames at PERSIST_TIMES (seconds): this
// step writes them to PERSIST_FILE (default <outDir>/persist.json); persistcheck compares them
// after the project was reopened or the app restarted.
import fs from "node:fs";
import path from "node:path";
import { engineFrame, rulerMap, seek, tallTimeline } from "./_preview.mjs";
import { checks, duration, pick, savedProject, selected } from "./_anim.mjs";

export const run = async (ctx, mode) => {
  const { win, udDir, outDir } = ctx;
  const file = process.env.PERSIST_FILE || path.join(outDir, "persist.json");
  if (process.env.PERSIST_TALL) await tallTimeline(win);
  const map = (ctx.map = await rulerMap(win));
  const doc = await savedProject(win, udDir);
  const animated = doc.timeline.clips.filter((c) => c.animationIn || c.transitionOut || (c.captionStyle && c.captionStyle !== "none")).slice(0, 4);
  const now = { clips: {}, frames: {} };
  for (const c of animated) {
    await pick(ctx, doc, c.clipId);
    now.clips[c.clipId] = { in: await selected(win, "Animation"), words: await selected(win, "Words"), transition: await selected(win, "Transition"), duration: (await duration(win))?.value ?? null };
  }
  for (const s of (process.env.PERSIST_TIMES || "0.5,5").split(",").map(Number)) {
    await seek(win, map, s);
    now.frames[s] = (await engineFrame(win)).sum;
  }
  if (mode === "save") {
    fs.writeFileSync(file, JSON.stringify(now, null, 1));
    return `saved ${Object.keys(now.clips).length} clips, ${Object.keys(now.frames).length} frames: ${JSON.stringify(now.clips)}`;
  }
  const was = JSON.parse(fs.readFileSync(file, "utf8"));
  const { check, report } = checks();
  for (const [id, v] of Object.entries(was.clips)) check(`clip ${id.slice(0, 8)} shows ${JSON.stringify(v)}`, JSON.stringify(now.clips[id]) === JSON.stringify(v), JSON.stringify(now.clips[id]));
  for (const [s, sum] of Object.entries(was.frames)) check(`frame at ${s} s the same`, now.frames[s] === sum, `${now.frames[s]} vs ${sum}`);
  return report();
};

export default (ctx) => run(ctx, "save");
