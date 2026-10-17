// Caption styles on a draft's captions with spoken words (after capcut on a draft whose
// captions page three words with the spoken one in yellow): the tab shows the style; each
// style draws a different caption; going back draws the draft's own again; an In animation
// goes on top of the style; trimming either end keeps the caption following the speech.
// CAPTION_AT (seconds into the first caption) is when to compare.
import { diff, drag, grab, rulerMap, seek, settled, tallTimeline } from "./_preview.mjs";
import { bar, checks, choose, options, pick, savedClips, savedProject, selected } from "./_anim.mjs";

const STYLE = { caption_word_color: "Three words, spoken one highlighted", caption_one_word: "One word at a time", none: "Whole text" };

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  await tallTimeline(win);
  const map = (ctx.map = await rulerMap(win));
  const { check, report } = checks();
  const doc = await savedProject(win, udDir);
  const clip = doc.timeline.clips.filter((c) => c.spokenWords).sort((a, b) => +a.startTick - +b.startTick)[0];
  const id = clip.clipId;
  const [start, end] = [+clip.startTick / 1e6, +clip.endTick / 1e6];
  const t = start + +(process.env.CAPTION_AT || 1.6);
  const style = async () => (await savedClips(win, udDir)).find((c) => c.clipId === id)?.captionStyle;
  await pick(ctx, doc, id);
  await shot("w1-tab");
  check("shows the draft's style", (await selected(win, "Words")) === STYLE[clip.captionStyle], `${clip.captionStyle}: ${await selected(win, "Words")}`);
  const opts = await options(win, "Words");
  check("offers the three styles", opts.join() === Object.values({ a: STYLE.none, b: STYLE.caption_word_color, c: STYLE.caption_one_word }).join(), opts.join());
  await seek(win, map, t);
  await grab(win, "draft");
  for (const [key, label] of [["caption_one_word", STYLE.caption_one_word], ["none", STYLE.none]]) {
    await pick(ctx, doc, id);
    await choose(win, "Words", label);
    await seek(win, map, t);
    await grab(win, key);
    check(`${label}: saved, a different caption`, (await style()) === key && (await diff(win, "draft", key)).n > 0, `${await style()}; changed ${(await diff(win, "draft", key)).n}`);
  }
  check("one word and whole text differ", (await diff(win, "caption_one_word", "none")).n > 0);
  await pick(ctx, doc, id);
  await choose(win, "Words", STYLE.caption_word_color);
  await seek(win, map, t);
  await grab(win, "back");
  check("back to the draft's style draws it again", (await diff(win, "draft", "back")).n === 0, `changed ${(await diff(win, "draft", "back")).n}`);
  await shot("w2-style");

  // An In animation on the caption: the words type in at its start, the style holds after.
  await seek(win, map, start + 0.1);
  await grab(win, "start");
  await pick(ctx, doc, id);
  await choose(win, "Animation", "Type 1");
  await seek(win, map, start + 0.1);
  await grab(win, "typing");
  await seek(win, map, t);
  await grab(win, "typed");
  check("Type 1 on a caption: typing at its start, the style after", (await diff(win, "start", "typing")).n > 0 && (await diff(win, "draft", "typed")).n === 0, `${(await diff(win, "start", "typing")).n}, ${(await diff(win, "draft", "typed")).n}`);
  await pick(ctx, doc, id);
  await choose(win, "Animation", "None");

  // Trims: the end, then the start; the caption still follows the speech at `t`.
  let [x, y] = await bar(ctx, doc, id, end);
  await pick(ctx, doc, id);
  await settled(win, () => drag(win, x - 1, y, map.x(end - 0.8), y));
  await seek(win, map, t);
  await grab(win, "trim-end");
  let saved = (await savedClips(win, udDir)).find((c) => c.clipId === id);
  check("end trimmed: same caption", +saved.endTick < +clip.endTick && (await diff(win, "draft", "trim-end")).n === 0, `${saved.endTick}; changed ${(await diff(win, "draft", "trim-end")).n}`);
  [x, y] = await bar(ctx, doc, id, start);
  await pick(ctx, doc, id);
  await settled(win, () => drag(win, x + 1, y, map.x(start + 0.5), y));
  await seek(win, map, t);
  await grab(win, "trim-start");
  saved = (await savedClips(win, udDir)).find((c) => c.clipId === id);
  check("start trimmed: same caption", +saved.startTick > +clip.startTick && (await diff(win, "draft", "trim-start")).n === 0, `${saved.startTick}; changed ${(await diff(win, "draft", "trim-start")).n}`);
  await shot("w3-trimmed");
  return report();
};
