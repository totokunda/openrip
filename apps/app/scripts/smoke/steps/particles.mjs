// Adjust ▸ Basic ▸ Effects ▸ Particles (after import timeline; CLIP_NAME=IMG_9079
// OPENRIP_ENGINE_MUTE=1, built app; docs/plan/capcut-ui-spec.md §6.23, 25-inspector-adjustment-
// layer/005-basic-scroll-3): the slider between Clarity and Fade with its field and keyframe
// diamond, film grain in the engine's frame (the pixel-to-pixel noise over a flat patch of the
// wall rises with the slider, and falls back at 0), the value saved on CapCut's 0 to 100 scale,
// undone and redone, a key at one time and another value later, and the project reopened with
// the grain still drawn.
import { rulerMap, seek } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { at, keyCase, mediaClip, open, savedClip, typeIn } from "./_inspector.mjs";
import { undoCase } from "./_undo.mjs";
import { spread } from "./_gaps.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const clip = await mediaClip(ctx);
  const id = clip.clipId;
  const T = 1.5;
  await at(ctx, id, T);
  const basic = () => open(win, "Adjust", "Basic");
  await basic();
  await win.waitForTimeout(400);
  const labels = await win.locator("[data-testid=inspector] [role=tabpanel] label").allInnerTexts();
  const names = labels.map((s) => s.trim());
  const i = names.indexOf("Particles");
  check("Particles is listed between Clarity and Fade", i > 0 && names[i - 1] === "Clarity" && names[i + 1] === "Fade", names.join(","));
  const plain = await spread(win, 0.5, 0.3, 0.12);
  await undoCase(ctx, check, "Particles 60", () => typeIn(win, "Particles", 60));
  const grain = await spread(win, 0.5, 0.3, 0.12);
  check("the saved clip has Particles on CapCut's scale", (await savedClip(ctx, id)).color?.adjust?.particles === 60, JSON.stringify((await savedClip(ctx, id)).color?.adjust));
  check("the engine's frame has grain: the pixel-to-pixel noise rises", grain > plain + 3, `${plain.toFixed(2)} → ${grain.toFixed(2)}`);
  await shot("pa-1-particles");
  await undoCase(ctx, check, "Particles 100", () => typeIn(win, "Particles", 100));
  const more = await spread(win, 0.5, 0.3, 0.12);
  check("more Particles is grainier", more > grain + 2, `${grain.toFixed(2)} → ${more.toFixed(2)}`);
  await undoCase(ctx, check, "Particles 0", () => typeIn(win, "Particles", 0));
  check("at 0 the picture is as it was", Math.abs((await spread(win, 0.5, 0.3, 0.12)) - plain) < 0.6);
  await undoCase(ctx, check, "Particles 40", () => typeIn(win, "Particles", 40));

  // Keyed: 0 at one time, 100 at another.
  await keyCase(ctx, check, "particles", { id, row: "Particles", t1: 1.2, t2: 4, reopen: basic, undoCase, set1: () => typeIn(win, "Particles", 0), set2: () => typeIn(win, "Particles", 100) });
  const keyed = await savedClip(ctx, id);
  check("the keys are saved", (keyed.keyframes?.["adjust:particles"]?.length ?? 0) === 2, JSON.stringify(keyed.keyframes?.["adjust:particles"]));

  // Reopen: still there and drawn at the later key.
  await (await import("./reopen.mjs")).default({ win, shot });
  const again = await savedClip(ctx, id);
  check("reopened, the keys are saved", again.keyframes?.["adjust:particles"]?.length === 2);
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 4);
  await win.keyboard.press("Escape");
  const late = await spread(win, 0.5, 0.3, 0.12);
  await seek(win, ctx.map, 1.2);
  const early = await spread(win, 0.5, 0.3, 0.12);
  check("and the engine draws grain at the 100 key and none at the 0 key", late > early + 3, `1.2 s ${early.toFixed(2)}, 4 s ${late.toFixed(2)}`);
  return report();
};
