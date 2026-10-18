// Remove BG ▸ Chroma key (after import timeline; CLIP_NAME for a photo): the key switched on,
// its colour picked from the picture with the eyedropper (the engine frame's colour where the
// click lands), then Intensity, Shadow, Edge smoothing and Spill, each undone and redone with
// the engine's frame and the saved project compared; the intensity keyed at two times; reset.
import { previewRect, settled } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { at, click, keyCase, mediaClip, open, savedClip, typeIn } from "./_inspector.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const clip = await mediaClip(ctx);
  const id = clip.clipId;
  const tab = () => open(win, "Video", "Remove BG");
  const T = 1.5;
  await at(ctx, id, T);
  await tab();
  const run = async (name, edit, opts) => {
    try {
      const r = await undoCase(ctx, check, name, edit, opts);
      if (!r.ok) await shot(`ic-fail-${name.replace(/\W+/g, "-")}`);
    } catch (e) {
      check(name, false, e.message.split("\n")[0]);
      await shot(`ic-fail-${name.replace(/\W+/g, "-")}`);
    }
  };
  // On: a key at intensity 0 keys nothing yet (CapCut's order), so only the project changes.
  await run("chroma key on", () => click(win, "[data-section='Chroma key'] [role=checkbox]"), { frame: false });

  // The eyedropper, then a click in the picture's middle (the canvas sits in the middle of the
  // player's stage): the colour there.
  const p = await previewRect(win);
  const spot = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  const want = await win.evaluate(({ fx, fy }) => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { fx: 0.5, fy: 0.5 });
  await run(
    "colour picked from the picture",
    async () => {
      await click(win, "[data-testid=chroma-eyedropper]");
      await settled(win, () => win.mouse.click(spot.x, spot.y));
    },
    { frame: false },
  );
  const picked = (await savedClip(ctx, id)).chroma;
  const rgb = [1, 3, 5].map((i) => parseInt(picked?.color?.slice(i, i + 2) ?? "00", 16));
  check(
    "the eyedropper takes the picture's colour where it's clicked, and the clip stays selected",
    rgb.every((v, i) => Math.abs(v - want[i]) < 24) && (await win.locator("[data-testid=section-chroma]").count()) === 1,
    `picked ${picked?.color} vs the frame's ${want}`,
  );
  await shot("ic-0-picked");

  await run("intensity", () => typeIn(win, "Intensity", 70));
  await run("shadow", () => typeIn(win, "Shadow", 60));
  await run("edge smoothing", () => typeIn(win, "Edge smoothing", 60));
  await run("spill", () => typeIn(win, "Spill", 80));
  await shot("ic-1-keyed");
  const saved = (await savedClip(ctx, id)).chroma;
  check("the key's sliders are saved", saved?.intensity === 70 && saved?.shadow === 60 && saved?.edgeSmooth === 60 && saved?.spill === 80, JSON.stringify(saved));
  await keyCase(ctx, check, "chroma intensity", { id, row: "Intensity", t1: 1, t2: 4, reopen: tab, undoCase, set1: () => typeIn(win, "Intensity", 0), set2: () => typeIn(win, "Intensity", 90) });
  await at(ctx, id, T);
  await tab();
  await run("chroma reset", () => click(win, "[aria-label='Reset Chroma key']"));
  await run("chroma key off", () => click(win, "[data-section='Chroma key'] [role=checkbox]"), { frame: false });
  return report();
};
