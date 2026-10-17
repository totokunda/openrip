// An opened draft's clips keep their timing: each converted clip's saved start and end are
// the ones the conversion wrote (`engine.base`), not a frame early. Run after capcut, and
// again after reopen.
import { checks, savedProject } from "./_anim.mjs";

export default async (ctx) => {
  const { win, udDir } = ctx;
  const { check, report } = checks();
  await win.waitForTimeout(1000);
  const doc = await savedProject(win, udDir);
  const moved = doc.timeline.clips.filter((c) => c.engine?.base && (c.startTick !== c.engine.base.startTick || c.endTick !== c.engine.base.endTick));
  check(`all ${doc.timeline.clips.length} clips where the draft has them`, moved.length === 0, moved.slice(0, 3).map((c) => `${c.clipId.slice(0, 8)} ${c.startTick}-${c.endTick} (draft ${c.engine.base.startTick}-${c.engine.base.endTick})`).join("; "));
  return report();
};
