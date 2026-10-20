// More clip actions › Trim clip (after `import timeline`; `~/Downloads/IMG_9079.MOV` with
// CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1; docs/plan/capcut-ui-spec.md §6.26/§6.28, shot
// `30-timeline-toolbar/010-video-context-more-actions.png`):
// - the clip's menu ▸ More clip actions has Trim clip, enabled for the video clip; it opens
//   the dialog on the clip's own in and out (the whole source, here) with a picture of the source
//   (the engine's decode) and a scrub cursor;
// - the In and Out handles dragged, the bar clicked to scrub (the picture follows the cursor),
//   Reset, and closing without Confirm change nothing in the project;
// - Confirm sets the clip's in-point and length in the saved project (trimStart, trimEnd, the
//   clip's end), keeps its start, and the engine's frame at the clip's start is the picture shown
//   at the In point; ⌘Z takes it all back in ONE step, ⇧⌘Z does it again;
// - trimmed again from its new in and out, the dialog opens on them and the whole source is on the bar.
// Shots: `tc1-dialog`, `tc2-handles`.
import { rulerMap, engineFrame, seek } from "./_preview.mjs";
import { checks, savedProject, clipsWhere, bar } from "./_anim.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const map = ctx.map ?? (ctx.map = await rulerMap(win));
  ctx.map = map;
  const doc = () => savedProject(win, udDir);
  const videoClip = (d) => clipsWhere(d, (c) => c.type === "video")[0];
  const fpsOf = (d) => d.settings?.fps || 24;
  const dialog = win.locator("[data-testid=trim-dialog]");
  const barEl = win.locator("[data-testid=trim-bar]");
  const num = async (attr) => +(await barEl.getAttribute(attr));
  const row = (name) => win.locator("button", { hasText: new RegExp(`^${name}`) }).filter({ hasText: name }).first();
  const light = () =>
    win.evaluate(() => {
      const c = document.querySelector("[data-testid=trim-picture]");
      if (!c) return -1;
      const g = c.getContext("2d");
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 765;
      return s / (d.length / 4);
    });
  const openDialog = async () => {
    const d = await doc();
    const c = videoClip(d);
    const [bx, by] = await bar(ctx, d, c.clipId, (+c.startTick + 3 * +c.endTick) / 4e6);
    await win.mouse.click(bx, by, { button: "right" });
    await win.waitForTimeout(450);
    await row("More clip actions").hover();
    await win.waitForTimeout(350);
    const item = row("Trim clip");
    const enabled = await item.isEnabled();
    await item.click();
    await dialog.waitFor({ timeout: 5000 });
    await win.waitForTimeout(700);
    return enabled;
  };
  const dragHandle = async (testId, toRatio) => {
    const box = await barEl.boundingBox();
    const h = await win.locator(`[data-testid=${testId}]`).boundingBox();
    await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * toRatio, h.y + h.height / 2, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(500);
  };

  const d0 = await doc();
  const v0 = videoClip(d0);
  const fps = fpsOf(d0);
  const len0 = (+v0.endTick - +v0.startTick) / 1e6;
  const trim0 = +(v0.trimStartTick ?? 0) / 1e6;

  // ---- the dialog ----
  await seek(win, map, Math.min(1, len0 / 4));
  const enabled = await openDialog();
  check("Trim clip is in More clip actions and enabled for the video clip", enabled);
  const total = await num("data-total");
  check("the dialog opens on the clip's own in and out (the whole source)", (await num("data-in")) === 0 && (await num("data-out")) === total && Math.abs(total / fps - (len0 + trim0)) < 0.25, `${await num("data-in")}..${await num("data-out")} of ${total} (${len0}s)`);
  check("a picture of the source shows", (await light()) > 0);
  await shot("tc1-dialog");
  const lightStart = await light();

  // ---- handles and scrubbing change nothing until Confirm ----
  await dragHandle("trim-in-handle", 0.25);
  const inA = await num("data-in");
  check("dragging the In handle sets the in point (about a quarter in)", Math.abs(inA - total * 0.25) <= 3, `${inA} of ${total}`);
  await dragHandle("trim-out-handle", 0.75);
  const outA = await num("data-out");
  check("dragging the Out handle sets the out point (about three quarters)", Math.abs(outA - total * 0.75) <= 3, `${outA} of ${total}`);
  check("the length is what's between", (await win.locator("[data-testid=trim-length]").innerText()).length > 0 && outA - inA > total * 0.4);
  const box = await barEl.boundingBox();
  await win.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await win.waitForTimeout(700);
  const cursor = await num("data-cursor");
  check("a click on the bar scrubs (the cursor moves there)", Math.abs(cursor - total * 0.5) <= 3, String(cursor));
  await shot("tc2-handles");
  await win.locator("[data-testid=trim-reset]").click();
  check("Reset puts the in and out back", (await num("data-in")) === 0 && (await num("data-out")) === total);
  await dragHandle("trim-in-handle", 0.3);
  await win.locator("[data-testid=trim-close]").click();
  await dialog.waitFor({ state: "hidden" });
  const dClosed = await doc();
  check("closing without Confirm changes nothing in the project", (+videoClip(dClosed).endTick === +v0.endTick) && +(videoClip(dClosed).trimStartTick ?? 0) === +(v0.trimStartTick ?? 0));

  // ---- Confirm ----
  await openDialog();
  await dragHandle("trim-in-handle", 0.25);
  await dragHandle("trim-out-handle", 0.7);
  const inB = await num("data-in");
  const outB = await num("data-out");
  // The picture at the In point, to compare with the engine's frame after.
  const box2 = await barEl.boundingBox();
  await win.mouse.click(box2.x + (box2.width * inB) / total + 1, box2.y + box2.height / 2);
  await win.waitForTimeout(900);
  const lightIn = await light();
  await win.locator("[data-testid=trim-confirm]").click();
  await dialog.waitFor({ state: "hidden" });
  await win.waitForTimeout(800);
  const d1 = await doc();
  const v1 = videoClip(d1);
  const len1 = (+v1.endTick - +v1.startTick) / 1e6;
  check("the saved clip keeps its start and is as long as the chosen stretch", +v1.startTick === +v0.startTick && Math.abs(len1 - (outB - inB) / fps) < 0.1, `${len1}s vs ${(outB - inB) / fps}s`);
  check("its in-point is the In handle's (trimStart) and the rest is trimEnd", Math.abs(+(v1.trimStartTick ?? 0) / 1e6 - inB / fps) < 0.1 && Math.abs(-(+(v1.trimEndTick ?? 0)) / 1e6 - (total - outB) / fps) < 0.1, `${v1.trimStartTick} ${v1.trimEndTick}`);
  await seek(win, map, +v1.startTick / 1e6);
  await win.waitForTimeout(900);
  const frame = await engineFrame(win);
  check("the engine's frame at the clip's start is the source at the In point", frame.light > 0.01 && Math.abs(frame.light - lightIn) < 0.1, `engine ${frame.light.toFixed(3)} dialog ${lightIn.toFixed(3)} (start ${lightStart.toFixed(3)})`);

  // ---- one undo step ----
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(900);
  const d2 = await doc();
  const v2 = videoClip(d2);
  check("one undo restores the clip's in, out and length", +v2.endTick === +v0.endTick && +(v2.trimStartTick ?? 0) === +(v0.trimStartTick ?? 0) && +(v2.trimEndTick ?? 0) === +(v0.trimEndTick ?? 0), JSON.stringify([v2.endTick, v2.trimStartTick, v2.trimEndTick]));
  await win.keyboard.press("Meta+Shift+z");
  await win.waitForTimeout(900);
  const v3 = videoClip(await doc());
  check("redo does it again", +v3.endTick === +v1.endTick && +(v3.trimStartTick ?? 0) === +(v1.trimStartTick ?? 0));

  // ---- trimmed again ----
  await openDialog();
  check("the dialog opens on the new in and out of the same whole source", Math.abs((await num("data-in")) - inB) <= 1 && Math.abs((await num("data-out")) - outB) <= 1 && (await num("data-total")) === total, `${await num("data-in")}..${await num("data-out")} of ${await num("data-total")}`);
  await win.locator("[data-testid=trim-reset]").click();
  await win.locator("[data-testid=trim-close]").click();
  await dialog.waitFor({ state: "hidden" });
  return report();
};
