// Home ▸ a project card's menu ▸ Duplicate (after `import timeline`; docs/plan/capcut-ui-spec.md
// §6.2): a copy named "<name> copy" appears in the grid and the list, with its own file, cover
// and media folder (the paths in its clips point into its own folder); it opens, and what is
// done in the copy (all its clips deleted) leaves the original's file as it was.
import fs from "node:fs";
import path from "node:path";
import { checks } from "./_anim.mjs";
import { goHome, openEditor } from "./_preview.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const dir = path.join(udDir, "projects-json");
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const projectFiles = () => fs.readdirSync(dir).filter((f) => /^project-\d+\.json$/.test(f));
  await win.waitForTimeout(2000);
  const files0 = projectFiles();
  const orig = files0.map((f) => ({ f, d: read(f) })).find((x) => x.d.timeline?.clips?.length);
  const origName = orig.d.meta.name;
  const origClips = orig.d.timeline.clips.length;

  await goHome(win);
  const card = (name) => win.locator("[data-testid=project-card]").filter({ hasText: name });
  await card(origName).first().hover();
  await win.locator(`[aria-label="More for ${origName}"]`).first().click();
  await shot("d1-card-menu");
  const item = win.locator("[data-testid=project-duplicate]");
  check("the card's menu has Duplicate", (await item.count()) === 1);
  await item.click();
  await win.waitForTimeout(2500);

  const files1 = projectFiles();
  const added = files1.filter((f) => !files0.includes(f));
  check("a second project file is written", added.length === 1, added.join(","));
  const copy = read(added[0]);
  check(`it is named "${origName} copy"`, copy.meta.name === `${origName} copy`, copy.meta.name);
  check("its clips are the original's", copy.timeline.clips.length === origClips, `${copy.timeline.clips.length} vs ${origClips}`);
  check("it has its own id", copy.meta.id !== orig.d.meta.id);
  const mediaPaths = JSON.stringify(copy).match(/\/media\/[^/"]+\//g) ?? [];
  check("its media paths point to its own folder, which exists", mediaPaths.length > 0 && mediaPaths.every((p) => p.includes(copy.meta.id)) && fs.existsSync(path.join(udDir, "media", copy.meta.id)), mediaPaths[0]);
  const coverOf = (f) => path.join(dir, "covers", f.replace(".json", ".jpg"));
  check("its cover is copied when the original has one", !fs.existsSync(coverOf(orig.f)) || fs.existsSync(coverOf(added[0])));
  await win.locator("[data-testid=project-card]").filter({ hasText: `${origName} copy` }).first().waitFor({ timeout: 5000 });
  check("the copy shows in the grid", (await card(`${origName} copy`).count()) === 1);
  await shot("d2-grid");
  await win.locator("[data-testid=home-view]").click();
  await win.waitForTimeout(400);
  await win.getByText("List", { exact: true }).first().click().catch(() => {});
  await win.waitForTimeout(600);
  check("and in the list", (await win.getByText(`${origName} copy`).count()) >= 1);
  await shot("d3-list");
  await win.keyboard.press("Escape");

  // Open the copy and empty it; the original stays.
  await win.getByText(`${origName} copy`).first().click().catch(() => {});
  await win.waitForTimeout(500);
  if (!(await win.locator("[data-testid=editor]").count())) {
    await win.locator(`[title="Open ${origName} copy"]`).first().click();
  }
  await win.waitForSelector("[data-testid=editor]", { timeout: 60000 });
  await win.waitForTimeout(2500);
  check("the copy opens on its own", (await win.locator("[data-testid=project-name]").inputValue()) === `${origName} copy`);
  await win.evaluate(() => document.activeElement?.blur?.());
  await win.keyboard.press("Meta+a");
  await win.keyboard.press("Backspace");
  await win.waitForTimeout(2500);
  const after = read(added[0]);
  check("deleting its clips empties the copy's file", after.timeline.clips.length === 0, `${after.timeline.clips.length} clips`);
  check("and leaves the original's file alone", read(orig.f).timeline.clips.length === origClips);
  await shot("d4-copy-edited");
  void openEditor;
  return report();
};
