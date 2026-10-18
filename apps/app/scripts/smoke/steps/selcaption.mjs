// Select a caption on an opened draft and open its Text tab: the first text clip as saved (the
// CAPTION_INDEX-th with it set), with the playhead inside it.
import { tab } from "./_preview.mjs";
import { clipsWhere, focus, savedProject } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  await win.keyboard.press("v");
  const doc = await savedProject(win, udDir);
  const caption = clipsWhere(doc, (c) => c.type === "text")[+(process.env.CAPTION_INDEX || 0)];
  if (!caption) throw new Error("no text clip");
  await focus(ctx, doc, caption);
  await tab(win, "Text");
  await shot("t1-text-tab");
  return `Text tab open on ${caption.clipId.slice(0, 8)}`;
};
