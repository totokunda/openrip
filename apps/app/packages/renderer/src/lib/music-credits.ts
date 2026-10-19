// The credit a library track keeps in the project, and the credits text for a video's
// description. A CC BY track asks for its title, its author, the licence and a link; CC0 and
// Public Domain ones ask for nothing but are listed too, marked, so the list is the whole story.
import type { Asset, AssetCredit } from "./types";

export const LICENSE_NAMES: Record<AssetCredit["license"], string> = {
  cc0: "CC0",
  pdm: "Public Domain Mark",
  by: "CC BY",
};

/** "CC BY 3.0", "CC0 1.0", "Public Domain Mark 1.0". */
export const licenseLabel = (c: Pick<AssetCredit, "license" | "licenseVersion">): string =>
  c.licenseVersion ? `${LICENSE_NAMES[c.license]} ${c.licenseVersion}` : LICENSE_NAMES[c.license];

/** True when the licence asks for a credit (CC BY). */
export const needsCredit = (c: Pick<AssetCredit, "license">): boolean => c.license === "by";

/** The credit a library track carries, from the track itself. */
export const creditOf = (t: {
  id: string;
  kind: "music" | "sfx";
  title: string;
  author: string;
  authorUrl?: string;
  license: AssetCredit["license"];
  licenseVersion?: string;
  licenseUrl: string;
  sourceUrl: string;
  source: string;
}): AssetCredit => ({
  id: t.id,
  kind: t.kind,
  title: t.title,
  author: t.author,
  authorUrl: t.authorUrl,
  license: t.license,
  licenseVersion: t.licenseVersion,
  licenseUrl: t.licenseUrl,
  sourceUrl: t.sourceUrl,
  source: t.source,
});

/** One credit as the line a CC BY attribution needs: "Title" by Author, licence (link), source (link). */
export const creditLine = (c: AssetCredit): string => {
  const by = c.authorUrl ? `${c.author} (${c.authorUrl})` : c.author;
  const base = `"${c.title}" by ${by}, ${licenseLabel(c)} (${c.licenseUrl}), ${c.sourceUrl}`;
  return needsCredit(c) ? base : `${base} (no credit required)`;
};

/** The credits of a project's assets: each library track once, in the order they were added. */
export const projectCredits = (assets: Record<string, Pick<Asset, "credit">> | undefined): AssetCredit[] => {
  const seen = new Set<string>();
  const out: AssetCredit[] = [];
  for (const a of Object.values(assets ?? {})) {
    const c = a?.credit;
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
};

/**
 * The credits as text to paste into a video's description. Tracks that need a credit come
 * first; "" when there are none.
 */
export const creditsText = (credits: AssetCredit[]): string => {
  if (credits.length === 0) return "";
  const music = credits.filter((c) => c.kind === "music");
  const sfx = credits.filter((c) => c.kind === "sfx");
  const sort = (list: AssetCredit[]) => [...list.filter(needsCredit), ...list.filter((c) => !needsCredit(c))];
  const block = (heading: string, list: AssetCredit[]) => (list.length ? [heading, ...sort(list).map(creditLine)].join("\n") : "");
  return [block("Music", music), block("Sound effects", sfx)].filter(Boolean).join("\n\n");
};
