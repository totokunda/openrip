// Turns on Settings › Edit › New timeline (Labs) for the steps after it: the canvas timeline
// (docs/plan/timeline-rewrite.md) takes the old one's place in the panel.
export default async ({ win, shot }) => {
  await win.evaluate(() => window[btoa("setPreferences")]({ newTimeline: true }));
  await win.waitForSelector("[data-testid=timeline-surface]", { timeout: 5000 });
  await win.waitForTimeout(800);
  await shot("tl2-on");
  return "new timeline on";
};
