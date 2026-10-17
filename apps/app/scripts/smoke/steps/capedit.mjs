// Edits in the tab on an opened draft, for persist: on captions with spoken words, one word at
// a time on the first and Type 2 over 1 s on the second; on a draft with transitions, the
// first one 1 s long and the second one replaced by White Fade.
import { rulerMap, tallTimeline } from "./_preview.mjs";
import { choose, pick, savedProject, setDuration } from "./_anim.mjs";

export default async (ctx) => {
  const { win, udDir } = ctx;
  await tallTimeline(win);
  ctx.map = await rulerMap(win);
  const doc = await savedProject(win, udDir);
  const byStart = (a, b) => +a.startTick - +b.startTick;
  const captions = doc.timeline.clips.filter((c) => c.spokenWords).sort(byStart);
  const transitions = doc.timeline.clips.filter((c) => c.transitionOut).sort(byStart);
  if (captions.length >= 2) {
    await pick(ctx, doc, captions[0].clipId);
    await choose(win, "Words", "One word at a time");
    await pick(ctx, doc, captions[1].clipId);
    await choose(win, "Animation", "Type 2");
    await setDuration(win, 1);
    return "one word at a time on the first caption, Type 2 over 1 s on the second";
  }
  await pick(ctx, doc, transitions[0].clipId);
  await setDuration(win, 1);
  await pick(ctx, doc, transitions[1].clipId);
  await choose(win, "Transition", "White Fade");
  return "the first transition 1 s, the second White Fade";
};
