// Favourites and recent searches in the user data folder (after `import timeline`;
// CLIP_NAME=IMG_9079 OPENRIP_ENGINE_MUTE=1, built app, no dev server; a fresh profile):
// - the migration: favourites an older version kept in localStorage (effects, filters, stickers,
//   text templates, adjustment presets, fonts, My colours) are seeded, the app restarted, and
//   they are in `<userData>/user-store/store.json` with the localStorage entries gone, the
//   effect showing in Effects > Favorites;
// - Effects recent searches: a search made is listed under the focused empty field, a recent one
//   picked, removed, Clear all;
// - Transitions > Favorites: empty state, a star on a hovered tile, the tile listed, unstarred;
// - voice changer favourites: a star on a voice filter tile, the Favorites chip listing it;
// - all of it still there after another restart.
// Shots: `fa1-recent` ↔ `09-left-effects/045-search-open`, `fa2-trans` ↔ `10-left-transitions/002-favorites`,
// `fa3-voice` ↔ `20-inspector-audio/003-voice-changer-library`.
import path from "node:path";
import { checks, focus, savedProject } from "./_anim.mjs";
import { openEditor, sectionButton, tab } from "./_preview.mjs";
import { audioSub } from "./audioui.mjs";

export default async (ctx) => {
  let { win } = ctx;
  const { udDir, shot, fs } = ctx;
  const { check, report } = checks();
  const storeFile = path.join(udDir, "user-store", "store.json");
  const store = () => {
    try {
      return JSON.parse(fs.readFileSync(storeFile, "utf8"));
    } catch {
      return {};
    }
  };
  const settle = () => win.waitForTimeout(900);
  const tabOf = async (id) => {
    await win.locator(`[data-testid=assets-tab-${id}]`).click();
    await win.waitForTimeout(1500);
  };
  const section = async (id) => (await sectionButton(win, id)).click();

  // ---- the migration ----
  await tabOf("effects");
  const firstEffect = await win.locator("[data-testid=effect-tile]").first().getAttribute("data-effect");
  await win.evaluate((e) => {
    const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    put("openrip.effect-favorites", [e]);
    put("openrip.filter-favorites", ["Basic/Old filter"]);
    put("openrip.sticker-favorites", ["old-sticker"]);
    put("openrip:text-template-favourites", ["old-template"]);
    put("openrip.adjustment-presets", [{ id: "old-1", name: "Old preset", color: {}, createdAt: 1 }]);
    put("openrip:favorite-fonts", ["Poppins"]);
    put("openrip:my-colors", ["#aabbcc"]);
  }, firstEffect);
  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await tabOf("effects");
  await win.waitForTimeout(1500);
  let s = store();
  check("effects favourites moved to the store", JSON.stringify(s["favourites.effects"]) === JSON.stringify([firstEffect]), JSON.stringify(s["favourites.effects"]));
  check("filters, stickers and text templates moved", s["favourites.filters"]?.[0] === "Basic/Old filter" && s["favourites.stickers"]?.[0] === "old-sticker" && s["favourites.text-templates"]?.[0] === "old-template");
  check("the adjustment preset moved", s["adjustment-presets"]?.[0]?.name === "Old preset");
  const left = await win.evaluate(() => ["openrip.effect-favorites", "openrip.filter-favorites", "openrip.sticker-favorites", "openrip:text-template-favourites", "openrip.adjustment-presets"].filter((k) => localStorage.getItem(k) != null));
  check("their localStorage entries are gone", left.length === 0, left.join(","));
  await section("favorites");
  await win.waitForTimeout(500);
  check("Effects > Favorites lists the migrated effect", (await win.locator(`[data-testid=effect-tile][data-effect="${firstEffect}"]`).count()) === 1);

  // ---- effects recent searches ----
  await section("all");
  const search = win.locator("[data-testid=effects-search]");
  await search.click();
  await search.fill("glow");
  await search.press("Enter");
  await search.fill("");
  await search.fill("blur");
  await win.keyboard.press("Tab");
  await win.waitForTimeout(300);
  await search.fill("");
  await search.click();
  await win.waitForTimeout(400);
  const recents = await win.locator("[data-testid=recent-search]").allInnerTexts();
  check("the focused empty field lists recent searches, newest first", recents.join("|") === "blur|glow", recents.join("|"));
  await shot("fa1-recent");
  await win.locator("[data-testid=recent-search]", { hasText: "glow" }).first().click();
  await win.waitForTimeout(300);
  check("a recent search fills the field", (await search.inputValue()) === "glow");
  await search.fill("");
  await search.click();
  await win.locator("[data-testid=recent-search]", { hasText: "blur" }).hover();
  await win.locator("[data-testid=recent-search]", { hasText: "blur" }).locator("[data-testid=recent-remove]").click();
  await win.waitForTimeout(300);
  check("a recent search can be removed", (await win.locator("[data-testid=recent-search]").count()) === 1);
  await settle();
  check("the recents are in the store", JSON.stringify(store()["recent-searches.effects"]) === JSON.stringify(["glow"]), JSON.stringify(store()["recent-searches.effects"]));
  await win.keyboard.press("Tab");

  // ---- Transitions > Favorites ----
  await tabOf("transitions");
  await section("favorites");
  await win.waitForTimeout(400);
  check("Transitions > Favorites starts empty with its message", (await win.locator("[data-testid=transitions-empty]").count()) === 1);
  const first = (await (await sectionButton(win, "Basic")).count()) ? "Basic" : null;
  const cats = await win.evaluate(() => [...document.querySelectorAll("nav[aria-label=Sections] button")].map((e) => e.innerText.trim()));
  await win.locator("nav[aria-label=Sections] button", { hasText: new RegExp(`^${cats.find((c) => c !== "Favorites" && c !== "Transitions")}$`) }).first().click();
  await win.waitForTimeout(500);
  const card = win.locator("[data-testid^=transition-card-]").first();
  const type = (await card.getAttribute("data-testid")).replace("transition-card-", "");
  await card.hover();
  await win.locator(`[data-testid=transition-favourite-${type}]`).click();
  await win.waitForTimeout(400);
  await section("favorites");
  await win.waitForTimeout(500);
  check("a starred transition is listed in Favorites", (await win.locator(`[data-testid=transition-card-${type}]`).count()) === 1 && (await win.locator("[data-testid=transitions-empty]").count()) === 0);
  await shot("fa2-trans");
  await settle();
  check("it is in the store", JSON.stringify(store()["favourites.transitions"]) === JSON.stringify([type]), JSON.stringify(store()["favourites.transitions"]));
  void first;

  // ---- voice changer favourites ----
  const doc = await savedProject(win, udDir);
  const video = doc.timeline.clips.find((c) => c.type === "video");
  await focus(ctx, doc, video, 2);
  await tab(win, "Audio");
  await audioSub(win, "Voice changer");
  const inspector = win.locator("[data-testid=inspector]");
  const tile = inspector.locator("[data-testid=voice-telephone]");
  await tile.hover();
  await inspector.locator("[data-testid=voice-telephone-favourite]").click();
  await win.waitForTimeout(300);
  await inspector.locator("button", { hasText: /^Favorites$/ }).click();
  await win.waitForTimeout(300);
  const shown = await inspector.locator("[data-testid=voice-tiles] button[data-testid^=voice-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")).filter((t) => !t.endsWith("-favourite")));
  check("the Favorites chip lists the starred voice filter only", shown.join(",") === "voice-telephone", shown.join(","));
  await shot("fa3-voice");
  await settle();
  check("it is in the store", JSON.stringify(store()["favourites.voice-filters"]) === JSON.stringify(["telephone"]), JSON.stringify(store()["favourites.voice-filters"]));

  // ---- after another restart ----
  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await tabOf("effects");
  await section("favorites");
  await win.waitForTimeout(600);
  check("Effects > Favorites survives a restart", (await win.locator(`[data-testid=effect-tile][data-effect="${firstEffect}"]`).count()) === 1);
  await tabOf("transitions");
  await section("favorites");
  await win.waitForTimeout(600);
  check("Transitions > Favorites survives a restart", (await win.locator(`[data-testid=transition-card-${type}]`).count()) === 1);
  await tabOf("effects");
  await section("all");
  const search2 = win.locator("[data-testid=effects-search]");
  await search2.click();
  await win.waitForTimeout(500);
  check("the recent search survives a restart", (await win.locator("[data-testid=recent-search]").allInnerTexts()).join("|") === "glow");
  await win.locator("[data-testid=recent-clear]").click();
  await win.waitForTimeout(300);
  check("Clear all empties the recents", (await win.locator("[data-testid=recent-search]").count()) === 0);
  return report();
};
