// The project's asset credits: the attribution every openly licensed asset (the Media tab's stock
// Library, and the Audio tab's music and sound effects) carries in `asset.credit`, collected in
// one place for the Credits dialog and its text. Pure (types only), so it can be tested with
// `node --test tests/` in packages/renderer.
//
// An asset joins the list by having `credit` set (lib/types.ts AssetCredit). Anything that adds
// openly licensed media to a project sets it; nothing else here needs to know where it came from.
import type { Asset, AssetCredit } from "./types.ts";

/** One line of credit: `"Title" by Author, CC BY 4.0, via Wikimedia Commons: https://…`. */
export const creditLine = (c: AssetCredit): string => {
  const by = c.author ? ` by ${c.author}` : "";
  const licence = c.licenseUrl ? `${c.license} (${c.licenseUrl})` : c.license;
  const via = c.sourceUrl ? `${c.sourceName}: ${c.sourceUrl}` : c.sourceName;
  return `"${c.title}"${by}, ${licence}, via ${via}`;
};

const sameCredit = (a: AssetCredit, b: AssetCredit) => (a.id && b.id ? a.id === b.id : a.title === b.title && (a.author ?? "") === (b.author ?? "") && a.license === b.license && a.sourceName === b.sourceName && (a.sourceUrl ?? "") === (b.sourceUrl ?? ""));

/** The credits of the assets given, each once (the same item added twice is one credit), in the order they were added. */
export const collectCredits = (assets: Record<string, Pick<Asset, "credit"> | undefined> | Array<Pick<Asset, "credit">>): AssetCredit[] => {
  const out: AssetCredit[] = [];
  for (const a of Array.isArray(assets) ? assets : Object.values(assets)) {
    const c = a?.credit;
    if (!c || typeof c.title !== "string" || typeof c.license !== "string") continue;
    if (!out.some((x) => sameCredit(x, c))) out.push(c);
  }
  return out;
};

/** Credits CC BY requires (the others are given as a courtesy). */
export const requiredCredits = (list: AssetCredit[]): AssetCredit[] => list.filter((c) => c.attributionRequired);

const KIND_NAMES: Record<AssetCredit["kind"], string> = { video: "Videos", photo: "Photos", music: "Music", sound: "Sound effects" };

/**
 * The text to paste into a video's description: a heading per kind of asset, a line each. With
 * `onlyRequired` only the CC BY credits (the ones the licence asks for) are listed.
 */
export const creditsText = (list: AssetCredit[], onlyRequired = false): string => {
  const chosen = onlyRequired ? requiredCredits(list) : list;
  if (chosen.length === 0) return "";
  const lines: string[] = [];
  for (const kind of Object.keys(KIND_NAMES) as AssetCredit["kind"][]) {
    const of = chosen.filter((c) => c.kind === kind);
    if (of.length === 0) continue;
    lines.push(`${KIND_NAMES[kind]}:`, ...of.map((c) => `- ${creditLine(c)}`), "");
  }
  return lines.join("\n").trimEnd();
};

/** What the dialog says about the list: "2 of 5 need credit". */
export const creditsSummary = (list: AssetCredit[]): string => {
  const need = requiredCredits(list).length;
  if (list.length === 0) return "No openly licensed assets in this project.";
  return `${list.length} openly licensed asset${list.length === 1 ? "" : "s"}, ${need === 0 ? "none need" : `${need} ${need === 1 ? "needs" : "need"}`} credit.`;
};
