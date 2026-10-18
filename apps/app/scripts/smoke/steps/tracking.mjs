// Motion tracking through its controls (after import timeline newtext, on IMG_9079 with
// CLIP_NAME=IMG_9079: the text 0–3 s over a man standing at a door, his face high in the
// picture):
// - the text's tabs (Text, Animation, Tracking, …); the Tracking tab as CapCut's: the checkbox,
//   None chosen, Start off; Motion tracking shows Direction (Both), Scale and Distance (on)
//   and Rotation (off), and the region on the player;
// - the text made green (to find it in the engine's frames) and Scale and Distance off, so it
//   moves with the face rigidly; the region dragged onto the face and sized to it from a
//   corner; Start: progress while the engine tracks, then the text's position keys saved, one
//   undo step (⌘Z / ⇧⌘Z);
// - the engine's frames follow: at times through the text, the green text sits where its keys
//   say, and the face (found by block matching in the engine's frames, independently of the
//   tracker) moved as the text did;
// - None takes the keys off (⌘Z puts them back);
// - Track mask: a rectangle mask drawn on the face, Track: the mask's poses saved and undoable,
//   and the masked picture in the engine's frames moving with them.
import { drag, engineFrame, grab, rulerMap, seek, settled, tab } from "./_preview.mjs";
import { checks, clipsWhere, savedProject, select } from "./_anim.mjs";
import { press, textColor, undoCase } from "./_undo.mjs";

// The face in IMG_9079's upright picture at its start (fractions): centre and size.
const FACE = { x: 0.546, y: 0.29, w: 0.185, h: 0.156 };

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  ctx.map ??= await rulerMap(win);
  const { check, report } = checks();
  let doc = await savedProject(win, udDir);
  const text = clipsWhere(doc, (c) => c.type === "text")[0];
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  if (!text || !video) throw new Error("needs a text over a video (import timeline newtext)");
  const fps = doc.settings?.fps || 24;
  const savedClip = async (id) => (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === id);
  const pick = 0.5;

  // The text green, the playhead half a second in.
  await seek(win, ctx.map, pick);
  await select(ctx, doc, text.clipId);
  await tab(win, "Text");
  await textColor(win, "text-color", "00ff00");

  // Its tabs, and the Tracking tab as CapCut's.
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector-tabs] [role=tab]")].map((e) => e.innerText.trim()));
  check("a text's tabs: Text, Animation, Tracking, Duration", tabs.join() === "Text,Animation,Tracking,Duration", tabs.join());
  await tab(win, "Tracking");
  const pressed = async (id) => (await win.locator(`[data-testid=${id}]`).getAttribute("aria-pressed")) === "true";
  const on = async (id) => (await win.locator(`[data-testid=${id}]`).getAttribute("aria-checked")) === "true";
  check("the Tracking checkbox on, None chosen, Start off", (await win.locator("[data-testid=tracking-enabled]").getAttribute("data-state")) === "checked" && (await pressed("tracking-none")) && (await win.locator("[data-testid=tracking-start]").isDisabled()));
  check("no region on the player yet", (await win.locator("[data-testid=tracking-region]").count()) === 0);
  await shot("tr1-tracking-default");
  await settled(win, () => win.locator("[data-testid=tracking-motion]").click(), { timeout: 1500 });
  const direction = (await win.locator("[data-testid=tracking-direction]").innerText()).trim();
  check("Motion tracking: Direction Both, Scale and Distance on, Rotation off", (await pressed("tracking-motion")) && direction === "Both" && (await on("tracking-scale")) && (await on("tracking-distance")) && !(await on("tracking-rotation")), `${direction}`);
  check("the region on the player, Start on", (await win.locator("[data-testid=tracking-region]").count()) === 1 && !(await win.locator("[data-testid=tracking-start]").isDisabled()));
  await shot("tr2-motion-tracking");
  await win.locator("[data-testid=tracking-scale]").click();
  await win.locator("[data-testid=tracking-distance]").click();
  await win.waitForTimeout(600);
  const t1 = await savedClip(text.clipId);
  check("Scale and Distance off, saved", t1.tracking?.scale === false && t1.tracking?.distance === false, JSON.stringify(t1.tracking));

  // The region onto the face: world units to the screen through the region's own box.
  const regionNow = async () => {
    const el = win.locator("[data-testid=tracking-region]");
    return { region: JSON.parse(await el.getAttribute("data-region")), rect: await el.boundingBox() };
  };
  let { region, rect } = await regionNow();
  const k = rect.width / region.width;
  const toScreen = (x, y) => [rect.x + rect.width / 2 + (x - region.cx) * k, rect.y + rect.height / 2 + (y - region.cy) * k];
  const vt = video.transform;
  const [bw, bh] = [vt.width * vt.scaleX, vt.height * vt.scaleY];
  const face = { cx: vt.x + FACE.x * bw, cy: vt.y + FACE.y * bh, w: FACE.w * bw, h: FACE.h * bh };
  {
    const [x0, y0] = [rect.x + rect.width / 2, rect.y + rect.height / 2];
    const [x1, y1] = toScreen(face.cx, face.cy);
    await drag(win, x0, y0, x1, y1);
    const corner = await win.locator("[data-testid=tracking-region-corner]").nth(3).boundingBox();
    const [x2, y2] = toScreen(face.cx + face.w / 2, face.cy + face.h / 2);
    await drag(win, corner.x + corner.width / 2, corner.y + corner.height / 2, x2, y2);
  }
  ({ region } = await regionNow());
  const near = Math.hypot(region.cx - face.cx, region.cy - face.cy) < 3 && Math.abs(region.width - face.w) < 4 && Math.abs(region.height - face.h) < 4;
  check("the region dragged onto the face and sized from a corner", near, `${JSON.stringify(region)} for ${JSON.stringify(face)}`);
  check("the text is still selected", (await win.locator("[data-testid=tracking-panel]").count()) === 1);
  await shot("tr3-region-on-face");

  // Start: progress, then keys; one undo step.
  const seen = [];
  const startAndWait = async () => {
    await win.locator("[data-testid=tracking-start]").click();
    for (let i = 0; i < 600; i++) {
      await win.waitForTimeout(100);
      const p = win.locator("[data-testid=tracking-progress]");
      if (await p.count()) {
        seen.push([+(await p.getAttribute("data-done")), +(await p.getAttribute("data-total"))]);
        if (seen.length === 3) await shot("tr4-tracking-progress");
      } else if (seen.length || i > 30) break;
    }
    await win.waitForTimeout(800);
  };
  const t0 = Date.now();
  await undoCase(ctx, check, "track", startAndWait, { frame: false });
  const done = seen.filter(([d, t]) => t > 0);
  check("progress while it tracks", done.length > 0 && done[done.length - 1][0] >= done[0][0], `${done.length} readings, last ${JSON.stringify(done[done.length - 1])}, ${((Date.now() - t0) / 1000).toFixed(1)} s with undo`);
  const tracked = await savedClip(text.clipId);
  const keys = tracked.keyframes?.position ?? [];
  const length = ((+tracked.endTick - +tracked.startTick) * fps) / 1e6;
  check(
    "the text's position keys saved, inside the clip, linear",
    keys.length >= 2 && keys.every((k) => k.frame >= -1e-6 && k.frame <= length + 1e-6 && k.ease === "linear") && !tracked.keyframes?.scale && !tracked.keyframes?.rotation,
    `${keys.length} keys over ${length.toFixed(0)} frames`,
  );
  check("tracking saved: motion, the video", tracked.tracking?.mode === "motion" && tracked.tracking?.video === video.clipId);
  const note = await win.locator("[data-testid=tracking-note]").count() ? await win.locator("[data-testid=tracking-note]").innerText() : "";
  check("not lost", !/lost/i.test(note), note);

  // The keyed centre at a timeline time (linear keys), in world units.
  const keyedAt = (s) => {
    const f = s * fps - (+tracked.startTick * fps) / 1e6;
    if (f <= keys[0].frame) return keys[0].value;
    for (let i = 1; i < keys.length; i++) {
      if (f <= keys[i].frame) {
        const u = (f - keys[i - 1].frame) / (keys[i].frame - keys[i - 1].frame);
        return [0, 1].map((c) => keys[i - 1].value[c] + (keys[i].value[c] - keys[i - 1].value[c]) * u);
      }
    }
    return keys[keys.length - 1].value;
  };
  const worldW = 600 * (doc.settings?.aspectRatio ? doc.settings.aspectRatio.width / doc.settings.aspectRatio.height : vt.width / vt.height);
  // The green text's centre in an engine frame (its own pixels).
  const greenCentre = (name) =>
    win.evaluate((name) => {
      const im = window.__grabs[name];
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < im.height; y++)
        for (let x = 0; x < im.width; x++) {
          const i = (y * im.width + x) * 4;
          if (im.data[i + 1] > 180 && im.data[i] < 90 && im.data[i + 2] < 90) {
            sx += x;
            sy += y;
            n++;
          }
        }
      return { x: sx / n, y: sy / n, n, w: im.width, h: im.height };
    }, name);
  // The shift of a patch of frame `a` around (x, y) that best matches frame `b` (±r px).
  const shift = (a, b, x, y, half, r) =>
    win.evaluate(({ a, b, x, y, half, r }) => {
      const [A, B] = [window.__grabs[a], window.__grabs[b]];
      const lum = (im, px, py) => {
        const i = (Math.round(py) * im.width + Math.round(px)) * 4;
        return im.data[i] * 0.2126 + im.data[i + 1] * 0.7152 + im.data[i + 2] * 0.0722;
      };
      let best = [Infinity, 0, 0];
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          let sad = 0;
          for (let py = -half; py <= half; py += 1) for (let px = -half; px <= half; px += 1) sad += Math.abs(lum(B, x + px + dx, y + py + dy) - lum(A, x + px, y + py));
          if (sad < best[0]) best = [sad, dx, dy];
        }
      return { dx: best[1], dy: best[2] };
    }, { a, b, x, y, half, r });
  const times = [0.5, 1.2, 1.9, 2.6];
  const placed = [];
  for (const s of times) {
    await seek(win, ctx.map, s);
    await win.waitForTimeout(300);
    await grab(win, `t${s}`);
    const g = await greenCentre(`t${s}`);
    const [wx, wy] = keyedAt(s);
    const px = g.w / worldW;
    placed.push({ s, g, want: [wx * px, wy * px], px });
  }
  // (The glyphs' centre isn't the box's, which the keys place: compare how far each moved.)
  const off = placed.slice(1).map((p) => Math.hypot(p.g.x - placed[0].g.x - (p.want[0] - placed[0].want[0]), p.g.y - placed[0].g.y - (p.want[1] - placed[0].want[1])));
  check("the engine draws the text where its keys say (its move from 0.5 s)", off.every((d) => d < 1.5), off.map((d) => d.toFixed(2)).join(", ") + " px");
  const spread = Math.max(...placed.map((p) => Math.hypot(p.want[0] - placed[0].want[0], p.want[1] - placed[0].want[1])));
  check("the keys move the text", spread > 1.5, `${spread.toFixed(1)} px`);
  // The face, measured in the frames: where it is at 0.5 s (the region's centre then), and
  // how far it moved by each later time, against the text's move.
  const px = placed[0].px;
  const [fx, fy] = [region.cx * px, region.cy * px];
  const half = Math.max(6, Math.round(Math.min(face.w, face.h) * px * 0.35));
  const agree = [];
  for (const p of placed.slice(1)) {
    const m = await shift(`t${times[0]}`, `t${p.s}`, fx, fy, half, 24);
    const text = [p.want[0] - placed[0].want[0], p.want[1] - placed[0].want[1]];
    agree.push(Math.hypot(m.dx - text[0], m.dy - text[1]));
  }
  check("the face moved as the text did (block matching in the engine's frames)", agree.every((d) => d <= 2.5), agree.map((d) => d.toFixed(1)).join(", ") + ` px (patch ${2 * half + 1} px)`);
  await seek(win, ctx.map, 1.9);
  await shot("tr5-text-following");

  // None takes the keys off, and ⌘Z puts them back.
  await select(ctx, await savedProject(win, udDir), text.clipId);
  await tab(win, "Tracking");
  await settled(win, () => win.locator("[data-testid=tracking-none]").click(), { timeout: 1500 });
  let c = await savedClip(text.clipId);
  check("None takes the position keys off", !c.keyframes?.position && c.tracking?.mode === "none");
  await press(win, "Meta+z");
  c = await savedClip(text.clipId);
  check("⌘Z puts them back", (c.keyframes?.position?.length ?? 0) === keys.length && c.tracking?.mode === "motion", `${c.keyframes?.position?.length}`);

  // Track mask: a rectangle on the face, then Track.
  doc = await savedProject(win, udDir);
  await seek(win, ctx.map, pick);
  await select(ctx, doc, video.clipId);
  await tab(win, "Mask");
  await win.locator("[data-testid=add-mask-rectangle]").click();
  {
    const [x0, y0] = toScreen(face.cx - face.w / 2, face.cy - face.h / 2);
    const [x1, y1] = toScreen(face.cx + face.w / 2, face.cy + face.h / 2);
    await settled(win, () => drag(win, x0, y0, x1, y1));
  }
  await win.locator("[data-testid=tool-chip-done]").click();
  await win.waitForTimeout(600);
  // The player's layout moves while the mask tool is out: put the mask exactly on the face
  // with its Transform fields (its top-left and size, in world units on the clip's box).
  await tab(win, "Mask");
  const setField = async (letter, value) => {
    const at = await win.evaluate((letter) => {
      const span = [...document.querySelectorAll("[data-testid=inspector] [role=tabpanel] span")].find((e) => e.innerText.trim() === letter && e.parentElement?.querySelector("input"));
      const input = span?.parentElement?.querySelector("input");
      if (!input) return null;
      input.scrollIntoView({ block: "center" });
      const r = input.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, letter);
    if (!at) throw new Error(`no ${letter} field`);
    await win.mouse.click(at.x, at.y, { clickCount: 3 });
    await win.keyboard.press("Meta+A");
    await win.keyboard.type(value.toFixed(1));
    await settled(win, () => win.keyboard.press("Enter"), { timeout: 2000 });
  };
  await setField("W", face.w);
  await setField("H", face.h);
  await setField("X", face.cx - vt.x - face.w / 2);
  await setField("Y", face.cy - vt.y - face.h / 2);
  doc = await savedProject(win, udDir);
  const mask0 = doc.timeline.clips.find((v) => v.clipId === video.clipId)?.masks?.find((m) => m.tool === "shape");
  check("a rectangle mask on the face", !!mask0, JSON.stringify(doc.timeline.clips.find((v) => v.clipId === video.clipId)?.masks?.map((m) => m.tool)));
  await tab(win, "Mask");
  const section = win.locator("[data-testid=track-mask]");
  check("Track mask: Direction Both, Hide and Track", (await section.count()) === 1 && (await win.locator("[data-testid=track-mask-direction]").innerText()).trim() === "Both" && (await win.locator("[data-testid=track-mask-hide]").count()) === 1);
  await section.scrollIntoViewIfNeeded();
  await shot("tr6-track-mask");
  const trackMask = async () => {
    await win.locator("[data-testid=track-mask-track]").click();
    for (let i = 0; i < 600; i++) {
      await win.waitForTimeout(100);
      if (!(await win.locator("[data-testid=track-mask] [data-testid=tracking-progress]").count()) && i > 5) break;
    }
    await win.waitForTimeout(800);
  };
  await undoCase(ctx, check, "track mask", trackMask, { frame: false });
  const mask = (await savedClip(video.clipId)).masks.find((m) => m.id === mask0?.id);
  const poses = Object.entries(mask?.keyframes ?? {}).map(([f, d]) => [+f, d.shapeBounds]).sort((a, b) => a[0] - b[0]);
  const xs = poses.map(([, b]) => b.x);
  check("the mask's poses saved, and moving", poses.length >= 2 && Math.max(...xs) - Math.min(...xs) > 1, `${poses.length} poses, x ${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}`);
  // The masked picture's centre in the engine's frames (the box round what's lit near where the
  // mask should be) against the mask's pose there.
  const lit = (name, cx, cy, reach) =>
    win.evaluate(({ name, cx, cy, reach }) => {
      const im = window.__grabs[name];
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let y = Math.max(0, Math.round(cy - reach)); y < Math.min(im.height, Math.round(cy + reach)); y++)
        for (let x = Math.max(0, Math.round(cx - reach)); x < Math.min(im.width, Math.round(cx + reach)); x++) {
          const i = (y * im.width + x) * 4;
          // Lit, and not the green text (nor its edges).
          const greenish = im.data[i + 1] > im.data[i] + 40 && im.data[i + 1] > im.data[i + 2] + 40;
          if (im.data[i] + im.data[i + 1] + im.data[i + 2] > 24 && !greenish) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }, { name, cx, cy, reach });
  const maskAt = (s) => {
    const f = Math.round(s * fps);
    const pose = poses.filter(([at]) => at <= f).pop()?.[1] ?? poses[0][1];
    // A rectangle turns about its top-left corner.
    const [w, h, r] = [pose.width * (pose.scaleX ?? 1), pose.height * (pose.scaleY ?? 1), ((pose.rotation ?? 0) * Math.PI) / 180];
    return [vt.x + pose.x + (Math.cos(r) * w - Math.sin(r) * h) / 2, vt.y + pose.y + (Math.sin(r) * w + Math.cos(r) * h) / 2];
  };
  const moved = [];
  // (After the text, which crosses the mask's place.)
  for (const s of [4, 6, 8]) {
    await seek(win, ctx.map, s);
    await win.waitForTimeout(300);
    await grab(win, `m${s}`);
    const [wx, wy] = maskAt(s);
    const l = await lit(`m${s}`, wx * px, wy * px, Math.max(face.w, face.h) * px);
    moved.push(Math.hypot(l.x - wx * px, l.y - wy * px));
  }
  check("the engine draws the clip inside the tracked mask", moved.every((d) => d < 2.5), moved.map((d) => d.toFixed(1)).join(", ") + " px from the mask's centre");
  await shot("tr7-mask-tracked");
  return report();
};
