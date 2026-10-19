// The first-run walkthrough (docs/plan/capcut-ui-spec.md §6.1). Run on a fresh profile WITH the
// tour on: `WALKTHROUGH=1 node session.mjs … walkthrough` (the session sets
// OPENRIP_NO_WALKTHROUGH for every other run, so the tour never blocks the other steps).
// Checks: it opens by itself on the first editor; the spotlight sits on the region (the import
// area, media panel, player, inspector, timeline, export button) with the step counter "n/6",
// a title and Next / Exit; Next walks all six and ends; the preference "walkthroughSeen" is
// saved; after a restart it doesn't open; Help ▸ Walkthrough shows it again from 1/6; Exit and
// Esc close it. Shots w1…w6 ↔ 31-dialogs/042-walkthrough-import-step.
import { checks } from "./_anim.mjs";
import { clickMenu } from "./_settings.mjs";
import { prefsOf } from "./_settings.mjs";

const REGIONS = ["media-import", "assets", "player", "inspector", "timeline", "export"];
const TITLES = ["Import materials", "Media panel", "Player", "Inspector", "Timeline", "Export"];

export default async (ctx) => {
  const { check, report } = checks();
  let win = ctx.win;
  const card = () => win.locator("[data-testid=walkthrough]");
  const spot = async () => win.locator("[data-testid=walkthrough-spot]").boundingBox();
  const region = async (id) => win.locator(`[data-testid=${id}]`).first().boundingBox();

  await card().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  check("the tour opens by itself on the first editor", await card().isVisible());
  check("it counts as seen at once", (await prefsOf(win)).walkthroughSeen === true);

  for (let i = 0; i < 6; i++) {
    await win.waitForTimeout(500);
    const step = (await win.locator("[data-testid=walkthrough-step]").innerText()).trim();
    const title = (await win.locator("[data-testid=walkthrough-card] >> text=" + TITLES[i]).count()) > 0;
    const s = await spot();
    const r = await region(REGIONS[i]);
    // The spotlight is the region plus a margin.
    const on = !!s && !!r && Math.abs(s.x - (r.x - 6)) < 4 && Math.abs(s.y - (r.y - 6)) < 4 && Math.abs(s.width - (r.width + 12)) < 6;
    check(`step ${i + 1}: counter ${i + 1}/6, "${TITLES[i]}", the spotlight on the ${REGIONS[i]} region`, step === `${i + 1}/6` && title && on, `${step} spot ${JSON.stringify(s)} region ${JSON.stringify(r)}`);
    await ctx.shot(`w${i + 1}-${REGIONS[i]}`);
    await win.locator("[data-testid=walkthrough-next]").click();
  }
  await win.waitForTimeout(400);
  check("Done on the last step closes it", !(await card().isVisible().catch(() => false)));

  // Restart on the same profile: it doesn't come back.
  const next = await ctx.relaunch();
  win = next.win;
  await win.waitForTimeout(2500);
  const { openEditor } = await import("./_preview.mjs");
  await openEditor(win);
  await win.waitForTimeout(2500);
  check("after a restart the tour stays closed", !(await card().isVisible().catch(() => false)));

  // From the menu, again; Exit closes it, Esc too.
  await clickMenu(ctx.app, "Walkthrough");
  await card().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  check("Help ▸ Walkthrough shows it again from 1/6", (await card().isVisible()) && (await win.locator("[data-testid=walkthrough-step]").innerText()).trim() === "1/6");
  await win.locator("[data-testid=walkthrough-next]").click();
  await win.locator("[data-testid=walkthrough-exit]").click();
  await win.waitForTimeout(300);
  check("Exit closes it", !(await card().isVisible().catch(() => false)));
  await clickMenu(ctx.app, "Walkthrough");
  await win.waitForTimeout(600);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
  check("Esc closes it", !(await card().isVisible().catch(() => false)));
  return report();
};
