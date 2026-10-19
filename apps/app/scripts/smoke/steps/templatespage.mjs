// Templates (after `import timeline`; Project 1 holds the clip): the page's empty state (how
// templates work), a project saved as a template from its card's menu, the page's card (cover,
// "1 clip | length", name), the Orientation filter and search, Rename from the right-click menu,
// Use template (a new project with its own copy of the clip and media, the original deleted
// meanwhile without harm), and Delete.
// Shots: s1-empty ↔ 01-home/028-templates-page (empty), s2-card ↔ 028 with a card,
// s3-orientation ↔ 029-templates-orientation-dropdown, s4-menu ↔ 032-template-item-hover.
import path from "node:path";
import { goHome } from "./_preview.mjs";
import { checks } from "./_anim.mjs";

export default async (ctx) => {
  const { win, shot, fs, udDir } = ctx;
  const { check, report } = checks();
  const dir = path.join(udDir, "projects-json");
  await goHome(win);
  await win.waitForTimeout(800);
  const uuid1 = JSON.parse(fs.readFileSync(path.join(dir, "project-1.json"), "utf8")).meta.id;

  await win.locator("[data-testid=home-nav-templates]").click();
  await win.waitForSelector("[data-testid=home-templates]");
  await win.waitForTimeout(500);
  check("empty state explains templates", (await win.locator("[data-testid=templates-empty]").count()) === 1 && (await win.getByText("Save as template").count()) > 0);
  await shot("s1-empty");
  await win.locator("[data-testid=templates-home]").click();
  await win.waitForSelector("[data-testid=project-card]");

  // Save Project 1 as a template.
  const card1 = win.locator("[data-testid=project-card][data-project-id='1']");
  await card1.hover();
  await card1.locator("button[aria-label^='More for']").click();
  await win.locator("[data-testid=project-save-template]").click();
  await win.waitForTimeout(2500);
  check("toast says it was saved", (await win.getByText(/as a template/).count()) > 0);
  const tdirs = fs.existsSync(path.join(dir, "templates")) ? fs.readdirSync(path.join(dir, "templates")) : [];
  check("a template folder with the project, record and cover", tdirs.length === 1 && ["project.json", "template.json"].every((f) => fs.existsSync(path.join(dir, "templates", tdirs[0], f))), tdirs.join());
  check("its media copied under its own name", fs.existsSync(path.join(udDir, "media", `tpl-${tdirs[0]}`, "symlinks")));
  check("the project's own media untouched", fs.existsSync(path.join(udDir, "media", uuid1)));

  await win.locator("[data-testid=home-nav-templates]").click();
  await win.waitForTimeout(800);
  const cards = win.locator("[data-testid=template-card]");
  check("the page lists it", (await cards.count()) === 1);
  const text = await cards.first().innerText();
  check("clip count and length shown", /1 clip \| 00:1[12]/.test(text), text.replace(/\n/g, " / "));
  check("with its cover", (await cards.first().locator("img").count()) === 1);
  await cards.first().hover();
  await win.waitForTimeout(300);
  await shot("s2-card");

  await win.locator("[data-testid=templates-orientation]").click();
  await win.waitForTimeout(300);
  await shot("s3-orientation");
  const ar = JSON.parse(fs.readFileSync(path.join(dir, "templates", tdirs[0], "template.json"), "utf8")).aspectRatio;
  const other = ar.height > ar.width ? "landscape" : "portrait";
  await win.locator(`[data-testid=templates-orientation-${other}]`).click();
  await win.waitForTimeout(300);
  check(`${other} hides a ${other === "portrait" ? "landscape" : "portrait"} template`, (await cards.count()) === 0 && (await win.locator("[data-testid=templates-none]").count()) === 1);
  await win.locator("[data-testid=templates-orientation]").click();
  await win.locator("[data-testid=templates-orientation-all]").click();
  await win.locator("[data-testid=templates-search]").fill("nomatch");
  check("search with no match", (await cards.count()) === 0);
  await win.locator("[data-testid=templates-search]").fill("");
  check("cleared", (await cards.count()) === 1);

  // Rename.
  await cards.first().click({ button: "right" });
  await shot("s4-menu");
  await win.locator("[data-testid=template-menu-rename]").click();
  await win.keyboard.type("My look");
  await win.keyboard.press("Enter");
  await win.waitForTimeout(800);
  check("renamed", (await cards.first().getAttribute("data-name")) === "My look");

  // Delete the source project: the template doesn't depend on it.
  await win.locator("[data-testid=home-nav-home]").click();
  await win.waitForSelector("[data-testid=project-card]");
  const p1 = win.locator("[data-testid=project-card][data-project-id='1']");
  await p1.hover();
  await p1.locator("button[aria-label^='More for']").click();
  await win.locator("[data-testid=project-delete]").click();
  await win.waitForTimeout(1500);
  check("the source project is in the Trash", !fs.existsSync(path.join(dir, "project-1.json")));

  // Use it.
  await win.locator("[data-testid=home-nav-templates]").click();
  await win.waitForTimeout(600);
  await cards.first().hover();
  await win.locator("[data-testid=template-use]").first().click();
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(5000);
  const total = +(await win.locator("[data-testid=player-time]").getAttribute("data-total"));
  check("a new project opens with the template's length", total > 11 && total < 12, `${total} s`);
  await shot("s5-from-template");
  // (Deleting the open project made an empty one for the editor; the new one has the clip.)
  const files = fs.readdirSync(dir).filter((f) => /^project-\d+\.json$/.test(f)).filter((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).timeline.clips.length > 0);
  check("one project with the clip, not the old one", files.length === 1 && files[0] !== "project-1.json", files.join());
  const made = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  const madeText = JSON.stringify(made);
  check("its own media folder, not the template's or the old project's", fs.existsSync(path.join(udDir, "media", made.meta.id, "symlinks")) && !madeText.includes(`/media/${uuid1}/`) && !madeText.includes(`tpl-${tdirs[0]}`) && madeText.includes(`/media/${made.meta.id}/`));
  check("one clip", made.timeline.clips.length === 1);
  const engineOk = await win.evaluate(() => {
    const c = document.getElementById("openrip-engine-frame");
    if (!c || !c.width) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4 * 97) sum += d[i] + d[i + 1] + d[i + 2];
    return sum > 1000;
  });
  check("the engine draws its picture", engineOk);
  await goHome(win);

  // Delete the template.
  await win.locator("[data-testid=home-nav-templates]").click();
  await win.waitForTimeout(600);
  await cards.first().click({ button: "right" });
  await win.locator("[data-testid=template-menu-delete]").click();
  await win.locator("[data-testid=template-delete-confirm]").click();
  await win.waitForTimeout(1000);
  check("deleted: the empty state is back", (await win.locator("[data-testid=templates-empty]").count()) === 1);
  check("its folder and media copy are gone", fs.readdirSync(path.join(dir, "templates")).length === 0 && !fs.existsSync(path.join(udDir, "media", `tpl-${tdirs[0]}`)));
  check("the project made from it is untouched", fs.existsSync(path.join(dir, files[0])) && fs.existsSync(path.join(udDir, "media", made.meta.id)));
  return report();
};
