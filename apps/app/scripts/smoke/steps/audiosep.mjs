// CapCut's "Audio is separated" (after `import timeline` on a clip with sound, e.g. IMG_9079
// with CLIP_NAME; OPENRIP_ENGINE_MUTE=1): once the video's sound is detached (⇧⌘S), its Audio
// tab says so instead of showing controls the engine would ignore; Recover audio gives the
// video its own sound back (the detached clip stays), one undo step, and the export plays both.
import { rulerMap, settled, tab } from "./_preview.mjs";
import { checks, clipsWhere, focus, savedProject } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { dbOf, exporter, pcm, side } from "./_audio.mjs";
import { key } from "./_timeline.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const exportAs = await exporter(ctx);
  let doc = await savedProject(win, ctx.udDir);
  const begin = +clipsWhere(doc, (c) => c.type === "video")[0].startTick / 1e6;
  const plain = side(pcm(await exportAs("as-plain"), begin + 2, 3), 0);
  await focus(ctx, doc, clipsWhere(doc, (c) => c.type === "video")[0], 1);
  await key(win, "Meta+Shift+s");
  await win.waitForTimeout(800);
  doc = await savedProject(win, ctx.udDir);
  const video = clipsWhere(doc, (c) => c.type === "video")[0];
  check("⇧⌘S detaches the sound", doc.assets[video.assetId].path.endsWith("#video") && doc.timeline.clips.some((c) => c.type === "audio"));
  await focus(ctx, doc, video, 1);
  await tab(win, "Audio");
  const inspector = win.locator("[data-testid=inspector]");
  check("the video's Audio tab says the sound is separated", (await inspector.locator("[data-testid=audio-separated]").isVisible()) && (await inspector.locator("[data-testid=audio-basic]").count()) === 0);
  await shot("as-1-separated");
  await undoCase(ctx, check, "recover audio", () => settled(win, () => inspector.getByRole("button", { name: "Recover audio" }).click()), { frame: false });
  doc = await savedProject(win, ctx.udDir);
  const back = clipsWhere(doc, (c) => c.type === "video")[0];
  check("Recover audio: the video's whole file again, the detached clip kept", !doc.assets[back.assetId].path.endsWith("#video") && doc.timeline.clips.some((c) => c.type === "audio"));
  check("its Audio tab has its controls back", await inspector.locator("[data-testid=audio-basic]").isVisible());
  const both = side(pcm(await exportAs("as-recovered"), begin + 2, 3), 0);
  const up = dbOf(both, plain);
  check(`the export plays the video's sound and the detached clip: ${up.toFixed(2)} dB up`, Math.abs(up - 6.02) < 0.6);
  return report();
};
