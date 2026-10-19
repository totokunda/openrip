// The Media tab's stock Library: what the three key-free sources return, and which of it may be
// used. Pure (no imports), so the main process's StockLibraryModule, the renderer and the tests
// (`node --test tests/` in packages/renderer) share it.
//
// Sources and the terms they are used under:
//  - Openverse images (https://api.openverse.org/v1/images/): its own index of openly licensed
//    pictures. Asked for CC0, Public Domain Mark and CC BY only, and each result's licence is
//    checked again here. The API is anonymous (20 requests a minute, 200 a day), so answers are
//    kept on disk.
//  - Wikimedia Commons (https://commons.wikimedia.org/w/api.php): videos and pictures. Only files
//    whose licence short name is CC0, a public-domain mark or CC BY (any version) are kept;
//    Share-Alike, NonCommercial, NoDerivatives, GFDL and anything with a "Restrictions" note
//    (personality rights, trademarks) are left out.
//  - NASA Image and Video Library (https://images-api.nasa.gov): NASA's media guidelines make its
//    own images and video free to use without permission (credit "NASA" is asked for, no
//    endorsement may be implied). Shown as "NASA (public domain)".

export type StockKind = "video" | "photo";
export type StockSource = "openverse" | "commons" | "nasa";

export const SOURCE_NAMES: Record<StockSource, string> = {
  openverse: "Openverse",
  commons: "Wikimedia Commons",
  nasa: "NASA Image and Video Library",
};

/** One stock video or photo, as the tiles list it and the project keeps it. */
export type StockItem = {
  /** Safe in a file name: `<source>-<hash of its address>`. */
  id: string;
  source: StockSource;
  kind: StockKind;
  title: string;
  author: string;
  authorUrl?: string;
  /** "CC0", "Public domain", "CC BY 4.0", "NASA (public domain)". */
  license: string;
  licenseUrl?: string;
  /** CC BY asks for credit; the rest don't (credits are offered for them anyway). */
  attributionRequired: boolean;
  /** The item's own page at its source. */
  sourceUrl: string;
  /** A small still, for the tile. */
  thumb: string;
  /** A small video that plays while the tile is hovered. */
  preview?: string;
  /** The file to download (a NASA item's is resolved in the main process: "nasa-asset:<id>"). */
  url: string;
  width?: number;
  height?: number;
  /** Seconds, when the source says. */
  duration?: number;
};

export type Licence = { name: string; url?: string; attribution: boolean };

// ---- licences ------------------------------------------------------------------------------

/** Commons' licence short names that may be used in a video without a share-alike duty. */
const COMMONS_OK = /^(?:CC0(?: 1\.0)?|CC BY (\d\.\d)(?: [A-Za-z]{2,3})?|PDM(?: 1\.0)?|Public domain|PD[- ].+)$/i;
const COMMONS_NO = /(?:\bSA\b|-SA\b|\bND\b|-ND\b|\bNC\b|-NC\b|GFDL|GPL|fair use|free art|copyrighted)/i;

/**
 * A Commons file's licence if it may be used (CC0, a public-domain mark, CC BY), else null.
 * `shortName` is the extmetadata's LicenseShortName.
 */
export const commonsLicence = (shortName: string | undefined, url?: string): Licence | null => {
  const name = (shortName ?? "").trim().replace(/\s+/g, " ");
  if (!name || COMMONS_NO.test(name) || !COMMONS_OK.test(name)) return null;
  const by = /^CC BY (\d\.\d)/i.exec(name);
  const pd = !by && !/^CC0/i.test(name);
  return {
    name: by ? name.replace(/^cc by/i, "CC BY") : /^CC0/i.test(name) ? "CC0" : "Public domain",
    url: url ? url.replace(/^http:/, "https:").replace(/\/deed\.\w+$/, "").replace(/\/?$/, "/") : by ? `https://creativecommons.org/licenses/by/${by[1]}/` : pd ? "https://creativecommons.org/publicdomain/mark/1.0/" : "https://creativecommons.org/publicdomain/zero/1.0/",
    attribution: !!by,
  };
};

/** Openverse's licence codes: cc0, pdm and by only. */
export const openverseLicence = (code: string | undefined, version?: string | null, url?: string | null): Licence | null => {
  const c = (code ?? "").toLowerCase();
  if (c === "cc0") return { name: "CC0", url: url || "https://creativecommons.org/publicdomain/zero/1.0/", attribution: false };
  if (c === "pdm") return { name: "Public domain", url: url || "https://creativecommons.org/publicdomain/mark/1.0/", attribution: false };
  if (c === "by") return { name: `CC BY${version ? ` ${version}` : ""}`, url: url || `https://creativecommons.org/licenses/by/${version || "4.0"}/`, attribution: true };
  return null;
};

export const NASA_LICENCE: Licence = { name: "NASA (public domain)", url: "https://www.nasa.gov/nasa-brand-center/images-and-media/", attribution: false };

// ---- small helpers -------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Text of a bit of HTML (Commons' Artist field): tags dropped, entities decoded, spaces squeezed. */
export const htmlText = (html: string | undefined): string =>
  (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();

/** The first link in a bit of HTML, made absolute (Commons' links are protocol-relative). */
export const htmlLink = (html: string | undefined): string | undefined => {
  const m = /href="([^"]+)"/i.exec(html ?? "");
  if (!m) return undefined;
  const raw = m[1].replace(/&amp;/g, "&");
  if (raw.startsWith("//")) return `https:${raw}`;
  return /^https?:\/\//i.test(raw) ? raw.replace(/^http:/, "https:") : undefined;
};

/** FNV-1a, 32 bits, in base 36: a short stable id from an address. */
export const hashId = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

export const stockId = (source: StockSource, key: string): string => `${source}-${hashId(key)}${hashId(key.split("").reverse().join(""))}`;

const clean = (s: unknown, max = 140): string => {
  const t = htmlText(typeof s === "string" ? s : "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** An address upgraded to https (a loopback one, the tests' fixture server, is left alone). */
const https = (u: unknown): string | undefined => (typeof u === "string" && /^https?:\/\//i.test(u) ? (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(u) ? u : u.replace(/^http:/, "https:")) : undefined);

// ---- Openverse -----------------------------------------------------------------------------

/** A tile from one Openverse image result, or null when it isn't openly usable or is flagged. */
export const normalizeOpenverse = (r: any): StockItem | null => {
  if (!r || typeof r !== "object") return null;
  const licence = openverseLicence(r.license, r.license_version, r.license_url);
  if (!licence) return null;
  if (r.mature) return null;
  if (Array.isArray(r.unstable__sensitivity) && r.unstable__sensitivity.length) return null;
  const url = https(r.url);
  const thumb = https(r.thumbnail) ?? url;
  const landing = https(r.foreign_landing_url) ?? https(r.detail_url);
  if (!url || !thumb || !landing || typeof r.id !== "string") return null;
  return {
    id: stockId("openverse", r.id),
    source: "openverse",
    kind: "photo",
    title: clean(r.title) || "Untitled",
    author: clean(r.creator, 80) || "Unknown author",
    authorUrl: https(r.creator_url),
    license: licence.name,
    licenseUrl: https(licence.url),
    attributionRequired: licence.attribution,
    sourceUrl: landing,
    thumb,
    url,
    width: num(r.width),
    height: num(r.height),
  };
};

// ---- Wikimedia Commons ---------------------------------------------------------------------

const COMMONS_VIDEO = new Set(["video/webm", "video/mp4"]);
const COMMONS_PHOTO = new Set(["image/jpeg", "image/png", "image/webp"]);
/** The longest side a downloaded Commons picture needs (a larger original is fetched as a 1920 px rendering). */
export const COMMONS_PHOTO_WIDTH = 1920;
/** Files bigger than this aren't offered (the sources' originals can run to gigabytes). */
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

/** `…/330px-File.jpg` as the same rendering at another width. */
export const thumbAt = (thumbUrl: string, width: number): string => thumbUrl.replace(/\/\d+px-/, `/${width}px-`);

/** A tile from one Commons page (`prop=imageinfo`, formatversion 2), or null when it can't be used. */
export const normalizeCommons = (page: any, kind: StockKind): StockItem | null => {
  const ii = page?.imageinfo?.[0];
  if (!ii || typeof page.title !== "string") return null;
  const meta = (k: string): string | undefined => {
    const v = ii.extmetadata?.[k]?.value;
    return typeof v === "string" ? v : undefined;
  };
  const licence = commonsLicence(meta("LicenseShortName"), meta("LicenseUrl"));
  if (!licence) return null;
  if (htmlText(meta("Restrictions"))) return null;
  const mime = String(ii.mime ?? "");
  const width = num(ii.width);
  const height = num(ii.height);
  let url: string | undefined = https(ii.url);
  let preview: string | undefined;
  let duration: number | undefined;
  if (kind === "video") {
    if (!COMMONS_VIDEO.has(mime) || !url) return null;
    const derivatives: any[] = Array.isArray(ii.derivatives) ? ii.derivatives : [];
    const playable = derivatives.filter((d) => /video\/(webm|mp4)/.test(String(d?.type)) && https(d?.src));
    const small = playable.filter((d) => Number(d.width) <= 480).sort((a, b) => Number(b.width) - Number(a.width))[0];
    if (small) preview = https(small.src);
    else if (num(ii.size) && ii.size <= 30 * 1024 * 1024) preview = url;
    if (num(ii.size) && ii.size > MAX_VIDEO_BYTES) {
      // Too big as uploaded: the largest rendering up to 1080 p, if there is one.
      const alt = playable.filter((d) => Number(d.height) <= 1080 && Number(d.width) <= 1920).sort((a, b) => Number(b.width) - Number(a.width))[0];
      if (!alt) return null;
      url = https(alt.src)!;
    }
    const length = (Array.isArray(ii.metadata) ? ii.metadata : []).find((m: any) => m?.name === "playtime_seconds" || m?.name === "length" || m?.name === "duration");
    duration = num(Number(length?.value));
  } else {
    if (!COMMONS_PHOTO.has(mime) || !url) return null;
    if (num(ii.size) && ii.size > MAX_PHOTO_BYTES * 4) return null;
    // A big original comes as a 1920 px rendering (smaller to download, plenty for a video).
    if (width && width > COMMONS_PHOTO_WIDTH && https(ii.thumburl)) url = thumbAt(https(ii.thumburl)!, COMMONS_PHOTO_WIDTH);
  }
  const thumb = https(ii.thumburl);
  if (!thumb || !url) return null;
  const artist = clean(meta("Artist"), 80);
  const credit = clean(meta("Credit"), 80);
  const author = artist || (credit && !/^own work$/i.test(credit) ? credit : "") || "Unknown author";
  return {
    id: stockId("commons", page.title),
    source: "commons",
    kind,
    title: clean(meta("ObjectName")) || page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
    author,
    authorUrl: htmlLink(meta("Artist")),
    license: licence.name,
    licenseUrl: licence.url,
    attributionRequired: licence.attribution,
    sourceUrl: https(ii.descriptionurl) ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    thumb,
    preview,
    url,
    width,
    height,
    duration,
  };
};

// ---- NASA ----------------------------------------------------------------------------------

/** A tile from one NASA search result (`collection.items[i]`). Its file is found when it is downloaded. */
export const normalizeNasa = (item: any, kind: StockKind): StockItem | null => {
  const d = item?.data?.[0];
  if (!d || typeof d.nasa_id !== "string" || d.media_type !== (kind === "video" ? "video" : "image")) return null;
  const links: any[] = Array.isArray(item.links) ? item.links : [];
  const thumb = https((links.find((l) => l?.rel === "preview") ?? links.find((l) => l?.render === "image"))?.href);
  if (!thumb) return null;
  const nid = d.nasa_id as string;
  const who = clean(d.photographer ?? d.secondary_creator, 80);
  const base = `https://images-assets.nasa.gov/${kind === "video" ? "video" : "image"}/${encodeURIComponent(nid)}/${encodeURIComponent(nid)}`;
  return {
    id: stockId("nasa", nid),
    source: "nasa",
    kind: kind,
    title: clean(d.title) || nid,
    author: who ? `${who} / NASA` : "NASA",
    license: NASA_LICENCE.name,
    licenseUrl: NASA_LICENCE.url,
    attributionRequired: false,
    sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(nid)}`,
    thumb,
    preview: kind === "video" ? `${base}~preview.mp4` : undefined,
    url: `nasa-asset:${nid}`,
  };
};

/** The file to fetch from a NASA asset manifest's hrefs (its listing of every rendition). */
export const nasaPick = (hrefs: string[], kind: StockKind): string | null => {
  const order = kind === "video" ? ["~medium.mp4", "~large.mp4", "~mobile.mp4", "~small.mp4"] : ["~orig.jpg", "~large.jpg", "~medium.jpg"];
  for (const suffix of order) {
    const hit = hrefs.find((h) => h.toLowerCase().endsWith(suffix));
    if (hit) return https(hit) ?? null;
  }
  return null;
};

// ---- merging -------------------------------------------------------------------------------

/** Lists interleaved (one from each in turn), so no source fills the first screen. */
export const interleave = <T>(lists: T[][]): T[] => {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
};
