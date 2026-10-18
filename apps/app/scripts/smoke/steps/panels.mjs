// The editor's panels' sizes (CSS px), to compare across a restart on the same profile: the
// layout keeps them. PANEL_ASSETS_WIDTH, when set, is the left panel's width to expect (±2 px).
import { checks } from "./_anim.mjs";

export default async ({ win }) => {
  const { check, report } = checks();
  const sizes = {};
  for (const id of ["assets", "player", "inspector", "timeline"]) {
    const b = await win.locator(`[data-testid=${id}]`).boundingBox();
    sizes[id] = b ? `${b.width.toFixed(0)}×${b.height.toFixed(0)}` : "none";
  }
  const want = process.env.PANEL_ASSETS_WIDTH;
  if (want) {
    const w = (await win.locator("[data-testid=assets]").boundingBox()).width;
    check(`the left panel kept its width (${want} px)`, Math.abs(w - +want) <= 2, `${w.toFixed(0)} px`);
  }
  return `${JSON.stringify(sizes)}${want ? `\n  ${report()}` : ""}`;
};
