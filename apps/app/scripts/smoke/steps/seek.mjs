// Move the playhead by clicking the ruler at SEEK_X (CSS px; RULER_Y its y, from a screenshot
// at 2x). Clicking where the playhead already is used to send it to 0, so step away first.
export default async ({ win, clock }) => {
  const x = Number(process.env.SEEK_X || 200);
  const y = Number(process.env.RULER_Y || 747);
  await win.mouse.click(x + 40, y);
  await win.waitForTimeout(300);
  await win.mouse.click(x, y);
  await win.waitForTimeout(900);
  return `at ${await clock()}`;
};
