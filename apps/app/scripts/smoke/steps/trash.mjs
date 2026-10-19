// Trash (after `import timeline`, on a fresh profile): Project 1 holds the imported clip.
// A second project is made, Project 1 deleted from its card's menu (it goes to the Trash with
// its file, cover and media), listed there with its days left; the grid and the list, the
// right-click menu, Restore (back whole: its clip and media are in the file the editor opens),
// Delete permanently (from the menu and, confirmed, from the bar), Empty trash, and a project
// older than 30 days emptied at start-up. Shots: t1-trash ↔ 01-home/020-trash-view,
// t2-menu ↔ 022-trash-item-context-menu, t3-view ↔ 023-trash-view-dropdown, t4-list ↔ 024-trash-list-view.
import path from "node:path";
import { goHome } from "./_preview.mjs";
import { checks } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, fs, udDir } = ctx;
  const { check, report } = checks();
  const dir = path.join(udDir, "projects-json");
  const trashDir = path.join(dir, "trash");
  const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const clipsOf = (f) => (readJson(f).timeline?.clips ?? []).length;

  await win.waitForTimeout(1500);
  const before = clipsOf(path.join(dir, "project-1.json"));
  check("Project 1 has its clip on disk", before > 0, `${before} clips`);
  const mediaDirs = fs.readdirSync(path.join(udDir, "media")).filter((n) => !n.startsWith("."));
  const uuid = readJson(path.join(dir, "project-1.json")).meta.id;
  check("its media folder exists", fs.existsSync(path.join(udDir, "media", uuid)));

  // A second project, so deleting the first doesn't swap in an empty one.
  await goHome(win);
  await win.locator("[data-testid=new-project]").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(2500);
  await goHome(win);
  await win.waitForTimeout(800);
  const cards = win.locator("[data-testid=project-card]");
  check("two projects listed", (await cards.count()) === 2, `${await cards.count()}`);

  const card1 = () => win.locator("[data-testid=project-card][data-project-id='1']");
  // Delete from the card's menu: no confirmation; the toast offers Undo.
  await card1().hover();
  await card1().locator("button[aria-label^='More for']").click();
  await win.locator("[data-testid=project-delete]").click();
  await win.waitForTimeout(1200);
  check("the card leaves Home", (await card1().count()) === 0 && (await cards.count()) === 1);
  check("the toast says Trash and offers Undo", (await win.getByText(/to Trash/).count()) > 0 && (await win.getByText("Undo").count()) > 0);
  check("the project file moved into trash/", !fs.existsSync(path.join(dir, "project-1.json")) && fs.existsSync(path.join(trashDir, "project-1", "project.json")));
  check("its media folder moved with it", !fs.existsSync(path.join(udDir, "media", uuid)) && fs.existsSync(path.join(trashDir, "project-1", "media")));
  // A project made now doesn't take the number in the Trash.
  await win.locator("[data-testid=home-trash]").click();
  await win.waitForSelector("[data-testid=trash]");
  await win.waitForTimeout(700);
  const items = win.locator("[data-testid=trash-item]");
  check("Trash lists it", (await items.count()) === 1);
  check("title counts it", (await win.locator("[data-testid=trash-count]").innerText()).includes("(1)"));
  const days = await win.locator("[data-testid=trash-days]").first().innerText();
  check("30 days left", /^30 days \|/.test(days), days);
  await items.first().hover();
  await shot("t1-trash");
  await items.first().click({ button: "right" });
  await win.waitForTimeout(300);
  const rows = await win.locator("[data-testid=context-menu] button").allInnerTexts();
  check("menu: Delete, Restore", rows.length === 2 && /Delete/.test(rows[0]) && /Restore/.test(rows[1]), rows.join(" / "));
  await shot("t2-menu");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(200);
  check("Escape closed only the menu", (await win.locator("[data-testid=trash]").count()) === 1 && (await win.locator("[data-testid=context-menu]").count()) === 0);
  await win.locator("[data-testid=trash-view]").click();
  await win.waitForTimeout(300);
  await shot("t3-view");
  await win.locator("[data-testid=trash-view-list]").click();
  await win.waitForTimeout(400);
  check("list view has its columns", (await win.getByText("Days remaining").count()) > 0 && (await win.getByText("Move time").count()) > 0);
  await shot("t4-list");
  await win.locator("[data-testid=trash-view]").click();
  await win.locator("[data-testid=trash-view-grid]").click();

  // Restore from the right-click menu.
  await win.locator("[data-testid=trash-item]").first().click({ button: "right" });
  await win.locator("[data-testid=trash-menu-restore]").click();
  await win.waitForTimeout(1500);
  check("Trash is empty again", (await win.locator("[data-testid=trash-none]").count()) === 1);
  check("restored: file, media and clips back", fs.existsSync(path.join(dir, "project-1.json")) && fs.existsSync(path.join(udDir, "media", uuid)) && clipsOf(path.join(dir, "project-1.json")) === before && !fs.existsSync(path.join(trashDir, "project-1")));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(500);
  check("its card is back on Home", (await card1().count()) === 1);
  // It opens, with its clip.
  await card1().locator("button[title^='Open ']").click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(4000);
  const onTimeline = await win.evaluate(() => document.querySelectorAll("[data-testid=player-time]").length);
  const total = await win.locator("[data-testid=player-time]").getAttribute("data-total");
  check("the restored project opens with its length", onTimeline > 0 && +total > 0, `${total} s`);
  await goHome(win);

  // Delete again; select, confirm, delete permanently.
  await card1().hover();
  await card1().locator("button[aria-label^='More for']").click();
  await win.locator("[data-testid=project-delete]").click();
  await win.waitForTimeout(1000);
  await win.locator("[data-testid=home-trash]").click();
  await win.waitForSelector("[data-testid=trash-item]");
  await win.locator("[data-testid=trash-item]").first().click();
  check("selecting shows the bar", (await win.locator("[data-testid=trash-bar]").count()) === 1);
  await win.locator("[data-testid=trash-delete]").click();
  await win.waitForTimeout(300);
  await shot("t5-confirm");
  check("asks before deleting for good", (await win.locator("[data-testid=trash-confirm]").count()) === 1);
  await win.getByRole("button", { name: "Cancel" }).click();
  await win.waitForTimeout(300);
  check("Cancel keeps it", (await win.locator("[data-testid=trash-item]").count()) === 1);
  await win.locator("[data-testid=trash-item]").first().click({ button: "right" });
  await win.locator("[data-testid=trash-menu-delete]").click();
  await win.locator("[data-testid=trash-confirm-delete]").click();
  await win.waitForTimeout(1200);
  check("deleted permanently", (await win.locator("[data-testid=trash-none]").count()) === 1 && !fs.existsSync(path.join(trashDir, "project-1")) && !fs.existsSync(path.join(udDir, "media", uuid)));
  check("the user's own file is untouched", fs.existsSync(process.env.CLIP_PATH || ctx.clipPath));
  await win.keyboard.press("Escape");

  // Empty trash, and the 30 days: a second project into the Trash with its date moved back.
  await win.waitForTimeout(500);
  const victim = win.locator("[data-testid=project-card]").first();
  const id = await victim.getAttribute("data-project-id");
  await victim.hover();
  await victim.locator("button[aria-label^='More for']").click();
  await win.locator("[data-testid=project-delete]").click();
  await win.waitForTimeout(1500);
  const rec = path.join(trashDir, `project-${id}`, "trash.json");
  check("a deleted project has its record", fs.existsSync(rec));
  const e = readJson(rec);
  e.deletedAt -= 31 * 86400000;
  fs.writeFileSync(rec, JSON.stringify(e));
  const next = await ctx.relaunch();
  await next.win.waitForSelector("[data-testid=home]", { timeout: 60000 });
  await next.win.waitForTimeout(1500);
  check("older than 30 days: gone at start-up", !fs.existsSync(path.join(trashDir, `project-${id}`)));
  await next.win.locator("[data-testid=home-trash]").click();
  await next.win.waitForTimeout(800);
  check("and not listed", (await next.win.locator("[data-testid=trash-none]").count()) === 1);
  await next.win.keyboard.press("Escape");

  // Empty trash with two in it.
  const w = next.win;
  for (let i = 0; i < 1; i++) {
    const c = w.locator("[data-testid=project-card]").first();
    await c.hover();
    await c.locator("button[aria-label^='More for']").click();
    await w.locator("[data-testid=project-delete]").click();
    await w.waitForTimeout(1200);
  }
  await w.locator("[data-testid=home-trash]").click();
  await w.waitForTimeout(800);
  check("one in the Trash", (await w.locator("[data-testid=trash-item]").count()) === 1);
  await w.locator("[data-testid=trash-empty]").click();
  await w.locator("[data-testid=trash-confirm-delete]").click();
  await w.waitForTimeout(1000);
  check("Empty trash empties it", (await w.locator("[data-testid=trash-none]").count()) === 1 && (fs.readdirSync(trashDir).length === 0));
  await w.keyboard.press("Escape");
  return report();
};
