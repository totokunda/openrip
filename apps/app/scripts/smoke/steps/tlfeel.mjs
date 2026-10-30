// Trims and drags as they feel by hand (after `import timeline newtext`: the clip alone on the
// main track from 0, a text 0-3 s over it). The clip is split at 6 s into A and B, then:
//   shrink/unshrink  A's right edge dragged in to 4 s and let go, then out again to 5.5 s; then
//                    in to 3 s and back out to 5 s in one drag; B's left edge in by a second and
//                    out again (its media comes back)
//   trim two         A and B selected, A's edge trimmed: both stay selected (Delete takes both)
//   move two         the magnet off, the text and B selected, B dragged a second and a half
//                    later: the text goes with it, and is drawn going with it during the drag;
//                    one ⌘Z puts both back
// Edges are taken hold of a few pixels inside the clip, as a hand does: a selected clip's
// trim handle is wider to grab than the bar drawn.
import { rulerMap, seek, settled, timelineRect } from "./_preview.mjs";
import { checks, select } from "./_anim.mjs";
import { button, clipsOn, doc, fpsOf, handleX, key, layout, mainClips, rowY, sec } from "./_timeline.mjs";

// The colour drawn at (x, y) in the timeline's canvases, and its lightness (0-255).
const pixelAt = (win, x, y) =>
  win.evaluate(({ x, y }) => {
    for (const c of document.querySelectorAll("canvas")) {
      const b = c.getBoundingClientRect();
      if (b.y < innerHeight * 0.3 || b.width < innerWidth * 0.6 || y < b.y || y > b.y + b.height) continue;
      const k = c.width / b.width;
      const [r, g, bl, a] = c.getContext("2d").getImageData(Math.round((x - b.x) * k), Math.round((y - b.y) * k), 1, 1).data;
      if (a === 0) continue;
      return { r, g, b: bl, lum: Math.round(0.3 * r + 0.59 * g + 0.11 * bl) };
    }
    return { r: 0, g: 0, b: 0, lum: 0 };
  }, { x, y });

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const map = ctx.map;
  const near = (a, b, frames) => Math.abs(a - b) <= frames;

  await seek(win, map, 6);
  await key(win, "Meta+b");
  let d = await doc(ctx);
  const f = fpsOf(d);
  let [A, B] = mainClips(d);
  check("⌘B cut the main track in two", mainClips(d).length === 2, layout(mainClips(d)));
  const y = await rowY(ctx, d, A.timelineId);
  // An edge of a selected clip dragged from `fromS` through `viaS` seconds to `toS`, taken
  // hold of `inside` pixels in from it (into the clip on that side, as a hand does: the edge's
  // handle is wider to grab than the bar drawn).
  const trim = async (fromS, toS, viaS, inside = 0) => {
    const hx = inside === 0 ? await handleX(win, map.x(fromS), y) : map.x(fromS) + inside;
    await settled(win, async () => {
      await win.mouse.move(hx, y);
      await win.mouse.down();
      for (const s of viaS != null ? [viaS, toS] : [toS]) await win.mouse.move(map.x(s), y, { steps: 10 });
      await win.mouse.up();
    });
    await win.waitForTimeout(700);
  };
  const reread = async () => {
    d = await doc(ctx);
    [A, B] = mainClips(d);
  };

  // Shrink, let go, unshrink.
  await seek(win, map, 9);
  await select(ctx, d, A.clipId, 2);
  await trim(6, 4);
  await reread();
  check("A's right edge dragged in to 4 s", near(A.e, 4 * f, 2), layout(mainClips(d)));
  await shot("tf1-shrunk");
  await trim(4, 5.5, null, -5);
  await reread();
  check("taken 5 px inside its edge and dragged out again to 5.5 s, A grows back", near(A.e, 5.5 * f, 2), layout(mainClips(d)));
  await trim(sec(d, A.e), 5, 3);
  await reread();
  check("in to 3 s and out to 5 s in one drag ends at 5 s", near(A.e, 5 * f, 2), layout(mainClips(d)));

  // B's left edge in a second, then out a second: its media comes back.
  const bTrim = B.trimStart ?? 0;
  const bLen = B.e - B.s;
  await select(ctx, d, B.clipId, sec(d, B.s) + 2);
  await trim(sec(d, B.s), sec(d, B.s) + 1);
  await reread();
  check("B's left edge dragged in a second", near(B.e - B.s, bLen - f, 2), `${layout(mainClips(d))}, trimStart ${B.trimStart}`);
  await trim(sec(d, B.s), sec(d, B.s) - 1, null, 5);
  await reread();
  check("and (5 px inside it) out a second, B is as long as before", near(B.e - B.s, bLen, 2), `${layout(mainClips(d))}, trimStart ${B.trimStart} (was ${bTrim})`);

  // Two selected, one trimmed: both stay selected. Pressed a pixel inside A's right edge, where
  // B's left edge meets it.
  const tabs = () => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector-tabs] [role=tab]")].map((e) => e.innerText.trim()).join(","));
  await select(ctx, d, A.clipId, 1);
  const oneTabs = await tabs();
  await win.keyboard.down("Shift");
  await win.mouse.click(map.x(sec(d, B.s) + 2), y);
  await win.keyboard.up("Shift");
  await win.waitForTimeout(500);
  const twoTabs = await tabs();
  check("A and B selected (the inspector's tabs for two)", twoTabs !== oneTabs, `${oneTabs} / ${twoTabs}`);
  await shot("tf2-two-selected");
  const aLen = A.e - A.s;
  const ex = map.x(sec(d, A.e)) - 5;
  await settled(win, async () => {
    await win.mouse.move(ex, y);
    await win.mouse.down();
    await win.mouse.move(map.x(sec(d, A.e) - 1), y, { steps: 10 });
    await win.mouse.up();
  });
  await win.waitForTimeout(700);
  await shot("tf3-two-trimmed");
  await reread();
  check("with two selected, A's right edge pressed 5 px inside the cut trims A", near(A.e - A.s, aLen - f, 2), layout(mainClips(d)));
  check("both stay selected after the trim", (await tabs()) === twoTabs, await tabs());
  const before = mainClips(d).length;
  await key(win, "Backspace");
  const left = mainClips(await doc(ctx)).length;
  check("and Delete takes both", before === 2 && left === 0, `${before} then ${left} on the main track`);
  await key(win, "Meta+z");
  await reread();

  // Two selected on different tracks, one dragged: the other goes with it.
  await button(win, "Main track magnet").click();
  await win.waitForTimeout(600);
  const textTrack = d.timeline.tracks.find((t) => t.type === "text");
  let T = clipsOn(d, textTrack.timelineId)[0];
  const ty = await rowY(ctx, d, textTrack.timelineId);
  await select(ctx, d, T.clipId, 1.5);
  await win.keyboard.down("Shift");
  await win.mouse.click(map.x(sec(d, B.s) + 2), y);
  await win.keyboard.up("Shift");
  await win.waitForTimeout(500);
  const [t0, b0] = [T.s, B.s];
  const fromX = map.x(sec(d, B.s) + 2);
  await win.mouse.move(fromX, y);
  await win.mouse.down();
  await win.mouse.move(fromX + (map.x(1.5) - map.x(0)) / 2, y, { steps: 8 });
  await win.mouse.move(fromX + map.x(1.5) - map.x(0), y, { steps: 8 });
  await win.waitForTimeout(300);
  await shot("tf4-dragging-two");
  // During the drag, the text's bar is drawn moving with it: its old start is bare.
  const tl = await timelineRect(win);
  const bare = await pixelAt(win, map.x(0.3), ty);
  const later = await pixelAt(win, map.x(sec(d, T.e) + 0.6), ty);
  check("during the drag the text is drawn moving with B (its old start bare, past its old end filled)", bare.lum < 60 && later.lum > 60, `at 0.3 s ${JSON.stringify(bare)}, past its end ${JSON.stringify(later)}`);
  await win.mouse.up();
  await win.waitForTimeout(1200);
  await shot("tf5-dropped-two");
  d = await doc(ctx);
  T = clipsOn(d, textTrack.timelineId)[0];
  [A, B] = mainClips(d);
  check("B moved about a second and a half (snapping may take it a little)", near(B.s - b0, 1.5 * f, 8), `B ${b0} → ${B.s}`);
  check("the text selected with it moved as far", near(T.s - t0, B.s - b0, 1), `text ${t0} → ${T.s}, ${tl.x}`);
  await key(win, "Meta+z");
  d = await doc(ctx);
  const [T2, B2] = [clipsOn(d, textTrack.timelineId)[0], mainClips(d)[1]];
  check("one ⌘Z puts both back", T2.s === t0 && B2.s === b0, `text ${T2.s}, B ${B2.s}`);
  await button(win, "Main track magnet").click();
  await win.waitForTimeout(600);
  return report();
};
