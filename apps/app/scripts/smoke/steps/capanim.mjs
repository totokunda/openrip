// Animation tab check on an opened draft. Coordinates (CSS px, from c2-capcut-opened.png at 2x):
// ANIM_LAYOUT='{"t0":75.5,"pps":272.7,"ruler":747,"caption":[185,778],"video":[604,830],"cut":4.03}'
// where t0/pps map seconds to ruler x, caption/video are clip bars, and cut is where the video
// meets the next clip (in the same ruler units). Sets Typewriter on the caption and White Flash
// on the video, and checks the engine's frames.
import { engineFrame, tab } from "./_preview.mjs";
const L = JSON.parse(process.env.ANIM_LAYOUT || '{"t0":75.5,"pps":272.7,"ruler":747,"caption":[185,778],"video":[604,830],"cut":4.03}');
// Clicking the ruler where the playhead already is used to send it to 0; step away first anyway.
const seek = async (win, s) => {
  await win.mouse.click(L.t0 + (s > 3 ? 1 : 5) * L.pps, L.ruler);
  await win.waitForTimeout(300);
  await win.mouse.click(L.t0 + s * L.pps, L.ruler);
  await win.waitForTimeout(900);
};
const choose = async (win, option) => {
  await win.locator("[role=tabpanel] [role=combobox]").first().click();
  await win.waitForTimeout(300);
  await win.getByRole("option", { name: option, exact: true }).click();
  await win.waitForTimeout(1500);
};
export default async ({ win, shot, clock }) => {
  const out = [];
  await win.keyboard.press("v");
  await seek(win, 0.25);
  const before = await engineFrame(win);
  await win.mouse.click(...L.caption);
  await win.waitForTimeout(600);
  await tab(win, "Animation");
  await shot("a1-animation-tab");
  await choose(win, "Typewriter");
  await seek(win, 0.25);
  const typing = await engineFrame(win);
  await shot("a2-typewriter");
  out.push(`caption changes with Typewriter: ${before.sum !== typing.sum} (clock ${await clock()})`);
  await win.mouse.click(...L.video);
  await win.waitForTimeout(600);
  await seek(win, L.cut);
  const cut0 = await engineFrame(win);
  await win.mouse.click(...L.video);
  await win.waitForTimeout(400);
  await tab(win, "Animation");
  await shot("a3-transition-tab");
  await choose(win, "White Flash");
  await seek(win, L.cut);
  const cut1 = await engineFrame(win);
  await shot("a4-white-flash");
  out.push(`lightness at the cut ${cut0.light.toFixed(2)} → ${cut1.light.toFixed(2)} (clock ${await clock()})`);
  return out.join("; ");
};
