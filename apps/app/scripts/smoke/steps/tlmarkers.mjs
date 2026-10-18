// Markers (after import timeline). Each change undone and redone (undoCase):
//   add       M at 2 s and at 6 s: saved as frames in the accent colour, named "Marker 01" and
//             "02" as in CapCut, drawn under the ruler
//   go        ⌥→ and ⌥← step the playhead between them
//   edit      a double-click on a flag opens its box: a colour, a new name kept on Done, a time
//             typed (HH:MM:SS:FF) that moves the marker
//   drag      a flag dragged along the ruler (snapping to the playhead at 7 s)
//   delete    a flag clicked and Delete; Delete all markers in timeline from its menu
import { now, rulerMap, seek, settled, timelineRect } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { doc, fpsOf, key } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const tl = await timelineRect(win);
  // The tag hangs from the ruler's foot (19–31 px under its top).
  const flagY = tl.y + 24;
  const markers = async () => (await doc(ctx)).timeline.markers ?? [];
  // Pixels of a colour around a time on the ruler.
  const flagPixels = (s, rgb) =>
    win.evaluate(({ x, y, rgb }) => {
      let n = 0;
      for (const c of document.querySelectorAll("canvas")) {
        const b = c.getBoundingClientRect();
        if (b.y > innerHeight * 0.3 && b.width > innerWidth * 0.75 && Math.abs(b.y - y + 24) < 2) {
          const k = c.width / b.width;
          const d = c.getContext("2d").getImageData(Math.round((x - b.x - 6) * k), Math.round((y - b.y - 6) * k), Math.round(12 * k), Math.round(12 * k)).data;
          for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 30 && Math.abs(d[i + 1] - rgb[1]) < 30 && Math.abs(d[i + 2] - rgb[2]) < 30 && d[i + 3] > 200) n++;
        }
      }
      return n;
    }, { x: map.x(s), y: flagY, rgb });

  const fps = fpsOf(await doc(ctx));
  await seek(win, map, 2);
  await undoCase(ctx, check, "add marker (M)", () => key(win, "m"), { frame: false });
  await seek(win, map, 6);
  await key(win, "m");
  let ms = await markers();
  check(
    "M adds markers at the playhead, saved in the accent colour with CapCut's names",
    ms.length === 2 && ms[0].frame === 2 * fps && ms[1].frame === 6 * fps && ms[0].color === "#AE81CE" && ms[0].note === "Marker 01" && ms[1].note === "Marker 02",
    JSON.stringify(ms.map(({ frame, color, note }) => ({ frame, color, note }))),
  );
  await seek(win, map, 0.5);
  check("the markers show on the ruler", (await flagPixels(2, [174, 129, 206])) > 20, `${await flagPixels(2, [174, 129, 206])} accent pixels at 2 s`);

  // Previous / next.
  await seek(win, map, 0.5);
  await key(win, "Alt+ArrowRight");
  const a = await now(win);
  await key(win, "Alt+ArrowRight");
  const b = await now(win);
  await key(win, "Alt+ArrowLeft");
  const c = await now(win);
  check("⌥→ and ⌥← go to the next and previous marker", a === 2 && b === 6 && c === 2, `${a}, ${b}, ${c}`);

  // Edit: note and colour.
  await seek(win, map, 4);
  await win.mouse.dblclick(map.x(2), flagY);
  await win.waitForTimeout(400);
  const box = win.locator("[data-marker-editor]");
  check("a double-click on a flag opens its box", (await box.count()) === 1);
  await undoCase(ctx, check, "marker colour", () => settled(win, () => box.locator('[aria-label="Colour #EB7A6B"]').click(), { timeout: 1500 }), { frame: false });
  await undoCase(ctx, check, "marker name", async () => {
    const input = box.locator('[aria-label="Marker name"]');
    await input.click({ clickCount: 3 });
    await input.fill("Intro");
    await settled(win, () => box.getByText("Done", { exact: true }).click(), { timeout: 1500 });
  }, { frame: false });
  ms = await markers();
  check("the box changes the marker's colour and name", ms[0].color === "#EB7A6B" && ms[0].note === "Intro" && (await box.count()) === 0, JSON.stringify(ms[0]));
  check("the flag takes its colour", (await flagPixels(2, [235, 122, 107])) > 20);

  // A time typed in the box moves the marker; then back. (The playhead off the flag first: its
  // line would take the double-click.)
  await seek(win, map, 4);
  await win.mouse.dblclick(map.x(2), flagY);
  await win.waitForTimeout(400);
  check("the box shows the marker's time as HH:MM:SS:FF", (await box.locator('[aria-label="Marker time"]').inputValue()) === "00:00:02:00");
  await undoCase(ctx, check, "marker time", async () => {
    const input = box.locator('[aria-label="Marker time"]');
    await input.click({ clickCount: 3 });
    await input.fill("00:00:03:00");
    await settled(win, () => input.press("Enter"), { timeout: 1500 });
  }, { frame: false });
  ms = await markers();
  check("a time typed in the box moves the marker", ms[0].frame === 3 * fps, `at ${ms[0].frame}`);
  await key(win, "Meta+z");

  // Drag: the 6 s flag to the playhead at 7 s.
  await seek(win, map, 7);
  const dr = await undoCase(ctx, check, "marker drag", async () => {
    await win.mouse.move(map.x(6), flagY);
    await win.mouse.down();
    await win.mouse.move(map.x(6.5), flagY, { steps: 6 });
    await win.mouse.move(map.x(7) - 3, flagY, { steps: 6 });
    await settled(win, () => win.mouse.up(), { timeout: 1500 });
  }, { frame: false });
  ms = await markers();
  check("a dragged flag moves its marker, snapping to the playhead", dr.ok && ms[1].frame === 7 * fps, `at ${ms[1].frame}`);

  // Delete: clicked, then Delete.
  await seek(win, map, 4);
  await undoCase(ctx, check, "marker delete", async () => {
    await win.mouse.click(map.x(2), flagY);
    await win.waitForTimeout(300);
    await key(win, "Backspace");
  }, { frame: false });
  ms = await markers();
  check("a clicked marker goes with Delete", ms.length === 1 && ms[0].frame === 7 * fps, JSON.stringify(ms.map((m) => m.frame)));

  // Its menu: Delete all markers in timeline (the playhead moved off the flag: its handle
  // would take the click).
  await key(win, "Meta+z");
  await seek(win, map, 4);
  await undoCase(ctx, check, "delete all markers", async () => {
    await win.mouse.click(map.x(2), flagY, { button: "right" });
    await win.waitForTimeout(300);
    await settled(win, () => win.getByRole("button", { name: "Delete all markers in timeline" }).click(), { timeout: 1500 });
  }, { frame: false });
  check("Delete all markers in timeline empties the ruler", (await markers()).length === 0);
  await key(win, "Meta+z");
  await ctx.shot("tl-markers");
  return report();
};
