// The Audio tab's Music and Sound effects libraries (after `import timeline`; on a clip with
// sound, `~/Downloads/IMG_9079.MOV` with CLIP_NAME=IMG_9079; OPENRIP_ENGINE_MUTE=1). A local
// fixture server stands in for Openverse (steps/_musicfixture.mjs; the app is restarted with
// OPENRIP_OPENVERSE_BASE pointing at it, so the step doesn't need the network). Checks:
// - a Music category lists its tracks, with title, artist, duration and licence, and none of
//   the BY-SA, BY-NC or ND ones the fixture leaks; the requests ask for cc0,pdm,by and say who
//   is asking; Sound effects likewise; the search finds a track and says when there's none;
// - a click previews (the row plays, the file is asked for, a second click stops it);
// - the download arrow shows a spinner then turns into "+", the file is in the user data;
// - "+" puts an audio clip at the playhead whose asset keeps title, author, licence and source,
//   and the export has its tone; a downloaded row dragged onto the timeline adds one too;
// - a star puts a track in Favorites (Music / Sound effects chips) and downloads it;
// - the finished Export screen lists the credits (what a CC BY credit needs), and the audio
//   clip's inspector shows the licence;
// - offline (the fixture stopped): a category not seen says so, one seen is still listed, a
//   favourite plays and adds with no network.
// Shots are named after the CapCut references: `ml-1-music` ↔ `06-left-audio/001-audio-default`,
// `ml-2-sfx` ↔ `027-sounds-trending`, `ml-3-hover` ↔ `025-music-item-hover`, `ml-6-favorites` ↔ `029-audio-yours`.
import fs from "node:fs";
import path from "node:path";
import { drag, openEditor, rulerMap, seek, settled, timelineRect } from "./_preview.mjs";
import { checks, focus, savedProject } from "./_anim.mjs";
import { band, exporter, pcm, side } from "./_audio.mjs";
import { audioSub } from "./audioui.mjs";
import { startFixture } from "./_musicfixture.mjs";

const section = (win, id) => win.locator(`[data-testid="assets-section-${id}"]`);
const rows = (win) => win.locator("[data-testid=music-row]");
const row = (win, title) => win.locator(`[data-testid=music-row][data-title="${title}"]`);
const titles = (win) => rows(win).evaluateAll((els) => els.map((e) => e.getAttribute("data-title")));
const open = async (win, id) => {
  await section(win, id).click();
  await win.waitForTimeout(900);
};
/** Wait for `fn` (a page-side predicate over the locator's element) to hold. */
const until = async (win, fn, ms = 15000) => {
  for (let i = 0; i < ms / 250; i++) {
    if (await fn()) return true;
    await win.waitForTimeout(250);
  }
  return false;
};
const audioClips = async (win, udDir) => (await savedProject(win, udDir)).timeline.clips.filter((c) => c.type === "audio");

export default async (ctx) => {
  const { check, report } = checks();
  const fixture = await startFixture();
  // The app talks to the fixture, not Openverse.
  process.env.OPENRIP_OPENVERSE_BASE = fixture.base;
  await ctx.relaunch();
  const { win, shot, udDir, outDir } = ctx;
  await openEditor(win);
  ctx.map = await rulerMap(win);
  const exportAs = await exporter(ctx);
  try {
    const plain = await exportAs("ml-plain");
    const doc0 = await savedProject(win, udDir);
    const begin = +doc0.timeline.clips.find((c) => c.type === "video").startTick / 1e6;
    const baseAudio = (await audioClips(win, udDir)).length;

    // ---- Music: a category ----
    await win.locator("[data-testid=assets-tab-audio]").click();
    await open(win, "music:Trending");
    const music = await titles(win);
    check(`Music ▸ Trending lists the allowed tracks (${music.join(", ")})`, music.join() === "Sunrise Anthem,Quiet Hours,Epic Journey");
    check("none of the BY-SA, BY-NC or ND tracks the fixture leaks are listed", !music.some((t) => /Share Alike|Non Commercial|No Derivs/.test(t)));
    const first = row(win, "Sunrise Anthem");
    const text = (await first.innerText()).replace(/\s+/g, " ");
    check(`a row has title, artist, duration and licence ("${text}")`, /Sunrise Anthem/.test(text) && /Fixture Artist · 00:06/.test(text) && /CC BY/.test(text));
    check("the column has the categories under Music and Sound effects", (await section(win, "music:Epic").count()) === 1 && (await section(win, "sfx:Whoosh").count()) === 1);
    const req = fixture.log.find((l) => l.path === "/v1/audio/");
    check(`the request asks for cc0,pdm,by only, music, and says who's asking (${req?.query.license}, ${req?.query.category}, ${req?.ua})`, req?.query.license === "cc0,pdm,by" && req?.query.category === "music" && /OpenRip/.test(req?.ua ?? ""));
    await shot("ml-1-music");

    // ---- a second category, and the search ----
    await open(win, "music:Epic");
    const epic = await titles(win);
    check(`Music ▸ Epic lists its track only (${epic.join(", ")})`, epic.length === 1 && epic[0] === "Epic Journey");
    const search = win.locator("[data-testid=music-search]");
    await search.fill("quiet");
    await until(win, async () => (await titles(win)).includes("Quiet Hours"));
    check(`the search finds a track across the library (${(await titles(win)).join(", ")})`, (await titles(win)).join() === "Quiet Hours");
    await search.fill("zzzz nothing");
    await until(win, async () => (await win.locator("[data-testid=music-none]").count()) > 0);
    check("a search with no match says so", (await win.locator("[data-testid=music-none]").count()) === 1);
    await search.fill("");

    // ---- Sound effects ----
    await open(win, "sfx:Trending");
    const sfx = await titles(win);
    check(`Sound effects ▸ Trending lists the allowed ones (${sfx.join(", ")})`, sfx.join() === "Big Whoosh,Mouse Click");
    check("a sound effect has the note cover, not a music one", (await row(win, "Big Whoosh").locator("svg").count()) >= 1);
    await shot("ml-2-sfx");
    await open(win, "sfx:Whoosh");
    check(`Whoosh finds the whoosh (${(await titles(win)).join(", ")}, none by NC)`, (await titles(win)).join() === "Big Whoosh");

    // ---- preview ----
    await open(win, "music:Trending");
    await row(win, "Sunrise Anthem").hover();
    await win.waitForTimeout(300);
    await shot("ml-3-hover");
    await row(win, "Sunrise Anthem").click({ timeout: 5000 }).catch((e) => { throw new Error(e.message.replace(/\n/g, " ").slice(500, 1400)); });
    const playing = await until(win, async () => (await row(win, "Sunrise Anthem").getAttribute("data-playing")) === "1", 8000);
    check("a click previews: the row plays", playing);
    check("the preview asked for the track's file", fixture.log.some((l) => l.path === "/files/1.wav"));
    await win.waitForTimeout(600);
    await row(win, "Sunrise Anthem").click();
    await win.waitForTimeout(400);
    check("a second click stops it", (await row(win, "Sunrise Anthem").getAttribute("data-playing")) === "0");

    // ---- download, then + ----
    fixture.delayMs.files = 1800;
    await row(win, "Sunrise Anthem").locator("[data-testid=music-download]").click();
    await win.waitForTimeout(500);
    check("the download shows a spinner", (await row(win, "Sunrise Anthem").locator("[data-testid=music-spinner]").count()) === 1);
    await shot("ml-4-downloading");
    const here = await until(win, async () => (await row(win, "Sunrise Anthem").getAttribute("data-cached")) === "1");
    fixture.delayMs.files = 0;
    const files = fs.existsSync(path.join(udDir, "music-library", "files")) ? fs.readdirSync(path.join(udDir, "music-library", "files")) : [];
    check(`it turns into a "+" and the file and its details are in the user data (${files.join(", ")})`, here && files.some((f) => f.endsWith(".wav")) && files.some((f) => f.endsWith(".json")) && (await row(win, "Sunrise Anthem").locator("[data-testid=music-add]").count()) === 1);

    await seek(win, ctx.map, 2);
    await settled(win, () => row(win, "Sunrise Anthem").locator("[data-testid=music-add]").click());
    const added = await audioClips(win, udDir);
    const doc1 = await savedProject(win, udDir);
    const clip = added.find((c) => doc1.assets[c.assetId]?.credit?.title === "Sunrise Anthem");
    check(`+ puts an audio clip at the playhead (${clip ? (+clip.startTick / 1e6).toFixed(2) : "none"} s)`, !!clip && Math.abs(+clip.startTick / 1e6 - 2) < 0.05 && added.length === baseAudio + 1);
    const credit = doc1.assets[clip?.assetId]?.credit;
    check(
      `its asset keeps title, author, licence and source (${JSON.stringify(credit)})`,
      credit?.title === "Sunrise Anthem" && credit?.author === "Fixture Artist" && credit?.license === "by" && credit?.licenseVersion === "3.0" && !!credit?.licenseUrl && /\/music\/1$/.test(credit?.sourceUrl ?? ""),
    );
    check("the row says it's added", (await row(win, "Sunrise Anthem").innerText()).includes("Added"));
    const withTone = await exportAs("ml-tone");
    const tone = (x) => side(pcm(x, begin + 2.3, 1.2), 0);
    const ratio = band(tone(withTone), 513, 533) / Math.max(1e-12, band(tone(plain), 513, 533));
    check(`the export has the track's 523 Hz tone at 2 s (×${ratio.toFixed(0)} against the plain export)`, ratio > 20);

    // ---- drag onto the timeline ----
    const before = (await audioClips(win, udDir)).length;
    await row(win, "Quiet Hours").locator("[data-testid=music-download]").click();
    await until(win, async () => (await row(win, "Quiet Hours").getAttribute("data-cached")) === "1");
    const r = await row(win, "Quiet Hours").boundingBox();
    const tl = await timelineRect(win);
    // Onto the audio track the first one made, after it.
    const track = (await savedProject(win, udDir)).timeline.tracks.find((t) => t.timelineId === clip.timelineId);
    await settled(win, () => drag(win, r.x + 60, r.y + r.height / 2, ctx.map.x(9.5), tl.y + 27 + track.timelineY + track.timelineHeight / 2));
    await shot("ml-5-dragged");
    const dragged = await audioClips(win, udDir);
    const doc2 = await savedProject(win, udDir);
    const dropped = dragged.find((c) => doc2.assets[c.assetId]?.credit?.title === "Quiet Hours");
    check(`a downloaded row dragged onto the timeline adds its audio, with its credit (${dragged.length - before} new, ${dropped ? (+dropped.startTick / 1e6).toFixed(1) : "none"} s)`, dragged.length === before + 1 && !!dropped);

    // ---- Favorites ----
    await open(win, "favorites");
    check("Favorites starts empty, with Music and Sound effects", (await win.locator("[data-testid=music-fav-empty]").count()) === 1 && (await win.locator("[data-testid=music-fav-sfx]").count()) === 1);
    await shot("ml-5-favorites-empty");
    await open(win, "music:Epic");
    await row(win, "Epic Journey").locator("[data-testid=music-favorite]").click();
    await open(win, "sfx:Whoosh");
    await row(win, "Big Whoosh").locator("[data-testid=music-favorite]").click();
    await win.waitForTimeout(800);
    await open(win, "favorites");
    check(`a starred track is in Favorites (${(await titles(win)).join(", ")})`, (await titles(win)).join() === "Epic Journey");
    await win.locator("[data-testid=music-fav-sfx]").click();
    check(`and the Sound effects chip has the starred sound (${(await titles(win)).join(", ")})`, (await titles(win)).join() === "Big Whoosh");
    await win.locator("[data-testid=music-fav-music]").click();
    const favFile = path.join(udDir, "music-library", "favorites.json");
    const favs = fs.existsSync(favFile) ? JSON.parse(fs.readFileSync(favFile, "utf8")) : [];
    check(`the favourites are kept whole on disk (${favs.map((f) => f.title).join(", ")})`, favs.length === 2 && favs.every((f) => f.author && f.license));
    check("a favourite is downloaded too, so it works offline", await until(win, async () => (await row(win, "Epic Journey").getAttribute("data-cached")) === "1"));
    await shot("ml-6-favorites");

    // ---- credits ----
    const doc3 = await savedProject(win, udDir);
    const sunrise = doc3.timeline.clips.find((c) => doc3.assets[c.assetId]?.credit?.title === "Sunrise Anthem");
    await focus(ctx, doc3, sunrise, 2.5);
    await audioSub(win, "Basic");
    const lic = win.locator("[data-testid=clip-license]");
    const licText = (await lic.innerText().catch(() => "")).replace(/\s+/g, " ");
    check(`the audio clip's inspector shows its licence ("${licText}")`, /Sunrise Anthem/.test(licText) && /Fixture Artist/.test(licText) && /CC BY 3\.0/.test(licText) && /credit required/.test(licText));
    await lic.scrollIntoViewIfNeeded().catch(() => {});
    await shot("ml-7-inspector-licence");
    // An export, kept open on its finished screen.
    await win.getByText("Export", { exact: true }).first().click();
    await win.waitForTimeout(1000);
    const dialog = win.getByRole("dialog").filter({ has: win.locator('input[placeholder="My export"]') });
    await dialog.locator('input[placeholder="My export"]').fill("ml-final");
    await dialog.locator('input[placeholder="/path/to/export"]').fill(outDir);
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await until(win, async () => (await win.locator("[data-testid=export-done-title]").count()) > 0, 120000);
    const credits = win.locator("[data-testid=audio-credits]");
    check("the Export dialog's finished screen has Audio credits", (await credits.count()) === 1 && (await win.locator("[data-testid=export-done-title]").count()) === 1);
    const list = await win.locator("[data-testid=audio-credit]").evaluateAll((els) => els.map((e) => e.textContent));
    check(`it lists each library track in the project (${list.join(" | ")})`, list.length === 2 && list.some((t) => /Sunrise Anthem/.test(t) && /Fixture Artist/.test(t) && /CC BY 3\.0/.test(t)) && list.some((t) => /Quiet Hours/.test(t) && /CC0/.test(t)));
    const pasted = await win.locator("[data-testid=audio-credits-text]").inputValue();
    check(
      `the text to paste has title, author, licence and links (${JSON.stringify(pasted)})`,
      /"Sunrise Anthem" by Fixture Artist \(http[^)]*\), CC BY 3\.0 \(https:\/\/creativecommons\.org\/licenses\/by\/3\.0\/\), http\S*\/music\/1/.test(pasted) && /"Quiet Hours".*\(no credit required\)/.test(pasted),
    );
    await shot("ml-8-credits");
    await win.keyboard.press("Escape");
    await win.waitForTimeout(500);

    // ---- offline ----
    await fixture.stop();
    await open(win, "music:Chill");
    await until(win, async () => (await win.locator("[data-testid=music-offline]").count()) > 0, 20000);
    const msg = (await win.locator("[data-testid=music-offline]").innerText().catch(() => "")).replace(/\s+/g, " ");
    check(`a category not seen before says it's offline, cleanly ("${msg}")`, /offline/i.test(msg) && /Favorites/.test(msg) && (await rows(win).count()) === 0);
    await shot("ml-9-offline");
    await open(win, "music:Epic");
    check("a category seen a moment ago is still listed", (await titles(win)).join() === "Epic Journey");
    await open(win, "favorites");
    const offlineRow = row(win, "Epic Journey");
    check("a favourite is on this machine", (await offlineRow.getAttribute("data-cached")) === "1");
    await until(win, async () => (await offlineRow.getAttribute("data-draggable")) === "1", 5000);
    await offlineRow.click();
    const offlinePlays = await until(win, async () => (await offlineRow.getAttribute("data-playing")) === "1", 8000);
    check("and plays with no network", offlinePlays);
    await offlineRow.click();
    const n0 = (await audioClips(win, udDir)).length;
    await seek(win, ctx.map, 9);
    await settled(win, () => offlineRow.locator("[data-testid=music-add]").click());
    check("and its + adds it", (await audioClips(win, udDir)).length === n0 + 1);
  } finally {
    await fixture.stop().catch(() => {});
    delete process.env.OPENRIP_OPENVERSE_BASE;
  }
  return report();
};
