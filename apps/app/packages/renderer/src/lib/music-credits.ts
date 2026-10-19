// What a library track's licence says, and the credit it keeps in the project (the shared
// AssetCredit, listed with the stock Library's in lib/credits.ts). A CC BY track asks for its
// title, its author, the licence and a link; CC0 and Public Domain ones ask for nothing but are
// listed too, marked, so the list is the whole story.
import type { AssetCredit } from "./types";

export type TrackLicense = "cc0" | "pdm" | "by";

export const LICENSE_NAMES: Record<TrackLicense, string> = {
  cc0: "CC0",
  pdm: "Public Domain Mark",
  by: "CC BY",
};

/** "CC BY 3.0", "CC0 1.0", "Public Domain Mark 1.0". */
export const licenseLabel = (t: { license: TrackLicense; licenseVersion?: string }): string =>
  t.licenseVersion ? `${LICENSE_NAMES[t.license]} ${t.licenseVersion}` : LICENSE_NAMES[t.license];

/** True when the licence asks for a credit (CC BY). */
export const needsCredit = (t: { license: TrackLicense }): boolean => t.license === "by";

/** "Freesound", "Jamendo", "Wikimedia Audio" from Openverse's "freesound", "wikimedia_audio"… */
export const sourceName = (source: string): string =>
  source
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ") || "Openverse";

/** The credit a library track carries, from the track itself. */
export const creditOf = (t: {
  id: string;
  kind: "music" | "sfx";
  title: string;
  author: string;
  authorUrl?: string;
  license: TrackLicense;
  licenseVersion?: string;
  licenseUrl: string;
  sourceUrl: string;
  source: string;
}): AssetCredit => ({
  id: t.id,
  kind: t.kind === "sfx" ? "sound" : "music",
  title: t.title,
  author: t.author,
  authorUrl: t.authorUrl,
  license: licenseLabel(t),
  licenseUrl: t.licenseUrl,
  sourceName: sourceName(t.source),
  sourceUrl: t.sourceUrl,
  attributionRequired: needsCredit(t),
});
