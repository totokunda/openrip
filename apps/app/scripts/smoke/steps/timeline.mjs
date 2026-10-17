// Drag the imported media item (CLIP_NAME, default IMG_9019) onto the empty timeline.
export default async ({ win, shot, clock }) => {
  const item = win.getByText(process.env.CLIP_NAME || "IMG_9019", { exact: false }).first();
  const drop = win.getByText("Drag and drop media to start creating");
  const a = await item.boundingBox(), b = await drop.boundingBox();
  await win.mouse.move(a.x + a.width / 2, a.y - 60);
  await win.mouse.down();
  await win.mouse.move(a.x + a.width / 2 + 10, a.y - 50, { steps: 5 });
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
  await win.waitForTimeout(300);
  await win.mouse.up();
  await win.waitForTimeout(3000);
  await shot("2-on-timeline");
  const c = await clock();
  if (!c || c.endsWith("00:00.00")) throw new Error(`no clip on the timeline (clock ${c})`);
  return c;
};
