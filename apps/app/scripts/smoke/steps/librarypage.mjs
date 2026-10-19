// The home Library page (after `import timeline`): the clip is in Project 1; a second project
// gets a photo. Home ▸ Library lists both across the projects (the video's picture drawn,
// the photo shown); chips All / Videos / Images / Audio, search, Favorites (a star, kept after
// a refresh), Grid and List, Sort (the order flipped), refresh, an empty state.
// Shots: l1-library ↔ 01-home/053-library-all, l2-sort ↔ 065-library-sort-dropdown,
// l3-view ↔ 058-library-view-dropdown, l4-list ↔ the list view, l5-images ↔ 055-library-images.
import { goHome } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { photoFixture, importFile } from "./_settings.mjs";

export default async (ctx) => {
  const { win, shot } = ctx;
  const { check, report } = checks();
  const photo = photoFixture(ctx);
  await goHome(win);
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(2500);
  await importFile(ctx, photo);
  await goHome(win);
  await win.waitForTimeout(500);

  await win.locator("[data-testid=home-nav-library]").click();
  await win.waitForSelector("[data-testid=home-library]");
  await win.waitForTimeout(2500);
  const items = win.locator("[data-testid=library-item]");
  const names = await items.evaluateAll((els) => els.map((e) => `${e.dataset.name}:${e.dataset.type}`));
  check("lists the video and the photo from two projects", names.some((n) => /IMG_9079\.MOV:video/.test(n)) && names.some((n) => /settings-photo\.png:image/.test(n)), names.join(", "));
  check("the page has its title, tab and chips", (await win.getByRole("heading", { name: "Library" }).count()) === 1 && (await win.locator("[data-testid=library-chips] button").count()) === 4);
  const picture = await win.locator("[data-testid=library-item][data-type=video] img").count();
  check("the video's picture is drawn", picture === 1);
  await shot("l1-library");

  await win.locator("[data-testid=library-chip-video]").click();
  check("Videos: just the video", (await items.count()) === 1 && (await items.first().getAttribute("data-type")) === "video");
  await win.locator("[data-testid=library-chip-image]").click();
  check("Images: just the photo", (await items.count()) === 1 && (await items.first().getAttribute("data-type")) === "image");
  await shot("l5-images");
  await win.locator("[data-testid=library-chip-audio]").click();
  check("Audio: nothing, and it says so", (await items.count()) === 0 && (await win.locator("[data-testid=library-empty]").count()) === 1);
  await win.locator("[data-testid=library-chip-all]").click();

  await win.locator("[data-testid=library-search-open]").click();
  await win.locator("[data-testid=library-search]").fill("photo");
  await win.waitForTimeout(300);
  check("search narrows by name", (await items.count()) === 1 && /photo/.test((await items.first().getAttribute("data-name")) ?? ""));
  await win.locator("[data-testid=library-search]").fill("zzzz");
  check("search with no match", (await items.count()) === 0);
  await win.locator("[data-testid=library-search]").press("Escape");
  await win.waitForTimeout(300);
  check("Escape clears it", (await items.count()) === 2);

  // Favourites.
  const video = win.locator("[data-testid=library-item][data-type=video]");
  await video.hover();
  await video.locator("[data-testid=library-star]").click();
  await win.locator("[data-testid=library-favorites]").click();
  check("Favorites: the starred one only", (await items.count()) === 1 && (await items.first().getAttribute("data-type")) === "video");
  await win.locator("[data-testid=library-refresh]").click();
  await win.waitForTimeout(1500);
  check("the star survives a refresh", (await items.count()) === 1);
  await win.locator("[data-testid=library-favorites]").click();

  // Sort: the order flips with Oldest first.
  const order = async () => items.evaluateAll((els) => els.map((e) => e.dataset.name));
  await win.locator("[data-testid=library-sort]").click();
  await win.waitForTimeout(300);
  await shot("l2-sort");
  const a = await order();
  await win.locator("[data-testid=library-order-oldest]").click();
  await win.waitForTimeout(300);
  const b = await order();
  check("Oldest first reverses Newest first", a.length === 2 && a[0] === b[1] && a[1] === b[0], `${a} | ${b}`);
  await win.locator("[data-testid=library-sort]").click();
  await win.locator("[data-testid=library-sort-created]").click();
  await win.waitForTimeout(300);
  check("Time created sorts too", (await items.count()) === 2);

  // View.
  await win.locator("[data-testid=library-view]").click();
  await win.waitForTimeout(300);
  await shot("l3-view");
  await win.locator("[data-testid=library-view-list]").click();
  await win.waitForTimeout(500);
  check("List view: rows with type and the projects using it", (await win.getByText("Used in").count()) === 1 && (await items.count()) === 2);
  await shot("l4-list");
  await win.locator("[data-testid=library-view]").click();
  await win.locator("[data-testid=library-view-grid]").click();

  // Right-click menu.
  await items.first().click({ button: "right" });
  const rows = await win.locator("[data-testid=context-menu] button").allInnerTexts();
  check("menu: favourite and show in Finder", rows.length === 2 && /Favorites/.test(rows[0]) && /Finder/.test(rows[1]), rows.join(" / "));
  await win.keyboard.press("Escape");
  return report();
};
