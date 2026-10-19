// A manual run of the Audio tab's libraries against the real Openverse (no fixture; needs the
// network; a handful of requests of the anonymous 200 a day). After `import timeline`:
// browse Music ▸ Trending and Sound effects ▸ Whoosh, preview a track, download one, add it at
// the playhead, and read its credit. Not part of the normal runs (`musiclib` uses a fixture).
import fs from "node:fs";
import path from "node:path";
import { rulerMap, seek, settled } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";

const until = async (win, fn, ms = 30000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await fn()) return true;
    await win.waitForTimeout(250);
  }
  return false;
};

export default async (ctx) => {
  const { win, shot, udDir } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const rows = win.locator("[data-testid=music-row]");
  const open = async (id) => {
    await win.locator(`[data-testid="assets-section-${id}"]`).click();
    await until(win, async () => (await rows.count()) > 0 || (await win.locator("[data-testid=music-error], [data-testid=music-offline], [data-testid=music-none]").count()) > 0);
  };
  await win.locator("[data-testid=assets-tab-audio]").click();
  await open("music:Trending");
  const music = await rows.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-title")} [${e.getAttribute("data-license")}]`));
  check(`Music ▸ Trending lists tracks from Openverse (${music.length}: ${music.slice(0, 4).join("; ")})`, music.length > 0);
  check("every listed track is cc0, pdm or by", (await rows.evaluateAll((els) => els.every((e) => ["cc0", "pdm", "by"].includes(e.getAttribute("data-license"))))) && music.length > 0);
  await shot("mr-1-music");
  await open("sfx:Whoosh");
  const sfx = await rows.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-title")} [${e.getAttribute("data-license")}]`));
  check(`Sound effects ▸ Whoosh lists sounds (${sfx.length}: ${sfx.slice(0, 4).join("; ")})`, sfx.length > 0);
  await shot("mr-2-sfx");
  const first = rows.first();
  const id = await first.getAttribute("data-id");
  const title = await first.getAttribute("data-title");
  await first.click();
  check(`a click previews "${title}" from its source`, await until(win, async () => (await rows.first().getAttribute("data-playing")) === "1", 20000));
  await first.click();
  await first.locator("[data-testid=music-download]").click();
  const here = await until(win, async () => (await rows.first().getAttribute("data-cached")) === "1", 60000);
  const files = fs.existsSync(path.join(udDir, "music-library", "files")) ? fs.readdirSync(path.join(udDir, "music-library", "files")) : [];
  check(`it downloads into the user data (${files.join(", ")})`, here && files.some((f) => f.startsWith(id)));
  await seek(win, ctx.map, 1);
  await settled(win, () => rows.first().locator("[data-testid=music-add]").click());
  const doc = await savedProject(win, udDir);
  const clip = doc.timeline.clips.find((c) => c.type === "audio");
  const credit = doc.assets[clip?.assetId]?.credit;
  check(`+ adds it with its credit (${JSON.stringify(credit)})`, !!clip && credit?.title === title && ["cc0", "pdm", "by"].includes(credit?.license) && /^https?:\/\//.test(credit?.sourceUrl ?? "") && !!credit?.author);
  await shot("mr-3-added");
  return report();
};
