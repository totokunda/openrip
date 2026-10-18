// Play 6 s from the start; reports the clock's rate against wall time.
import { playButton, timelineRect } from "./_preview.mjs";
export default async ({ win, clock }) => {
  const tl = await timelineRect(win);
  await win.mouse.click(tl.x + 20, tl.y + 12);
  await win.waitForTimeout(800);
  const b = await playButton(win).boundingBox();
  const play = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const secs = async () => { const c = await clock(); const m = c?.match(/(\d\d):(\d\d\.\d\d)/); return m ? +m[1] * 60 + +m[2] : 0; };
  const t0 = Date.now(), c0 = await secs();
  await win.mouse.click(play.x, play.y);
  await win.waitForTimeout(6000);
  const c1 = await secs(), t1 = Date.now();
  await win.mouse.click(play.x, play.y);
  return `clock rate ${((c1 - c0) / ((t1 - t0) / 1000)).toFixed(2)}x`;
};
