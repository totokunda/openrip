/**
 * The Audio tab's Music and Sound effects libraries, the parts that need no Electron (so the unit
 * tests in packages/renderer/tests/music-library.test.ts run them): which licences are allowed,
 * Openverse's results turned into tracks, the search URL, which hosts a track may come from, and
 * the polite request pacing.
 *
 * Licences. A track is only listed under CC0, the Public Domain Mark or CC BY (any version):
 * all three allow use in a video, commercial or not, with at most a credit line for CC BY. Left
 * out, on purpose:
 * - NC (non-commercial) and ND (no derivatives): a video with a soundtrack is commercial or a
 *   derivative as often as not, and a creator can't tell the viewer which.
 * - BY-SA (share-alike): setting a track to pictures is an adaptation under Creative Commons'
 *   own guidance, which would make the whole video BY-SA too. Not something to hand users
 *   quietly, so it isn't offered.
 * - "Sampling+" and the rest of the retired and unknown licences.
 */

export type MusicKind = "music" | "sfx";
export type MusicLicense = "cc0" | "pdm" | "by";

export const ALLOWED_LICENSES: readonly MusicLicense[] = ["cc0", "pdm", "by"];

/** What the panel lists: one openly licensed recording and where it came from. */
export type MusicTrack = {
  /** Openverse's id (a UUID). */
  id: string;
  kind: MusicKind;
  title: string;
  /** The creator; "Unknown artist" when the source gives none. */
  author: string;
  authorUrl?: string;
  license: MusicLicense;
  licenseVersion?: string;
  licenseUrl: string;
  /** The track's page at its source (Freesound, Jamendo, Wikimedia), for the credit. */
  sourceUrl: string;
  /** The source's name: "freesound", "jamendo", "wikimedia_audio"… */
  source: string;
  durationSec: number;
  /** The file to download. */
  url: string;
  /** The extension to keep it under. */
  ext: string;
  thumbnail?: string;
};

export const isAllowedLicense = (license: unknown): license is MusicLicense =>
  typeof license === "string" && (ALLOWED_LICENSES as readonly string[]).includes(license.trim().toLowerCase());

const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus"]);

const extOf = (url: string, filetype: unknown): string => {
  const t = typeof filetype === "string" ? filetype.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  // Jamendo calls its MP3 "mp32" (the second encoder profile).
  if (t.startsWith("mp3") || t === "mp32") return "mp3";
  if (AUDIO_EXTS.has(t)) return t === "oga" ? "ogg" : t;
  try {
    const m = /\.([a-z0-9]{2,4})$/i.exec(new URL(url).pathname);
    if (m && AUDIO_EXTS.has(m[1].toLowerCase())) return m[1].toLowerCase();
  } catch {
    // fall through
  }
  return "mp3";
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const http = (v: unknown): string | undefined => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

/** The id as a file name: Openverse's UUIDs, nothing that could reach outside the cache folder. */
export const TRACK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/;

/** One result of Openverse's `/v1/audio/`, or null when it isn't usable (wrong licence, no file, mature). */
export const toTrack = (raw: unknown, kind: MusicKind): MusicTrack | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const license = typeof r.license === "string" ? r.license.trim().toLowerCase() : "";
  if (!isAllowedLicense(license)) return null;
  if (r.mature === true) return null;
  const id = str(r.id);
  const url = http(r.url);
  const title = str(r.title);
  if (!id || !TRACK_ID.test(id) || !url || !title) return null;
  const ms = typeof r.duration === "number" ? r.duration : NaN;
  if (!(ms > 0)) return null;
  const version = str(r.license_version);
  const licenseUrl = http(r.license_url) ?? licenseLink(license, version);
  return {
    id,
    kind,
    title,
    author: str(r.creator) ?? "Unknown artist",
    authorUrl: http(r.creator_url),
    license,
    licenseVersion: version,
    licenseUrl,
    sourceUrl: http(r.foreign_landing_url) ?? url,
    source: str(r.source) ?? str(r.provider) ?? "openverse",
    durationSec: ms / 1000,
    url,
    ext: extOf(url, r.filetype),
    thumbnail: http(r.thumbnail),
  };
};

/** A licence's deed, for when the API gives none. */
export const licenseLink = (license: MusicLicense, version?: string): string => {
  if (license === "cc0") return `https://creativecommons.org/publicdomain/zero/${version ?? "1.0"}/`;
  if (license === "pdm") return `https://creativecommons.org/publicdomain/mark/${version ?? "1.0"}/`;
  return `https://creativecommons.org/licenses/by/${version ?? "4.0"}/`;
};

export type SearchRequest = { kind: MusicKind; q?: string; page?: number; pageSize?: number; /** A category tile, not typed text: kept longer. */ browse?: boolean };

/**
 * Openverse's search URL for a request: only the three licences (the API's own filter, then
 * `toTrack` again), music by its category, sound effects from Freesound (the one source with
 * sound-effect libraries).
 */
export const searchUrl = (base: string, req: SearchRequest): string => {
  const u = new URL(`${base.replace(/\/$/, "")}/v1/audio/`);
  const p = u.searchParams;
  if (req.q?.trim()) p.set("q", req.q.trim().slice(0, 100));
  p.set("license", ALLOWED_LICENSES.join(","));
  if (req.kind === "music") {
    p.set("category", "music");
  } else {
    p.set("source", "freesound");
  }
  p.set("page", String(Math.max(1, Math.floor(req.page ?? 1))));
  p.set("page_size", String(Math.min(40, Math.max(1, Math.floor(req.pageSize ?? 20)))));
  p.set("mature", "false");
  return u.href;
};

/** The hosts a track's file, a cover or a download may come from (and their subdomains). */
export const SOURCE_HOSTS = ["openverse.org", "freesound.org", "jamendo.com", "wikimedia.org"];

/** True for an https URL on a source host; or, for the tests' fixture server, `extra`'s host. */
export const allowedHost = (url: string, extra?: string): boolean => {
  try {
    const u = new URL(url);
    if (extra) {
      const e = new URL(extra);
      if (u.host === e.host) return true;
    }
    if (u.protocol !== "https:") return false;
    return SOURCE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

/** A cache file's name for a search: the request as a short stable string. */
export const searchKey = (req: SearchRequest): string => {
  const q = (req.q ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const slug = q.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  let h = 5381;
  for (const ch of `${req.kind}|${q}|${req.page ?? 1}|${req.pageSize ?? 20}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${req.kind}-${slug || "all"}-p${req.page ?? 1}-${h.toString(36)}`;
};

/** Browsing a category changes slowly (hours); a typed search a little faster (minutes). */
export const FRESH_MS = { browse: 6 * 3600_000, search: 30 * 60_000 };

/**
 * Anonymous Openverse allows 20 requests a minute and 200 a day. This keeps to 12 a minute (and
 * spaces them 1 s apart) and, on a 429, stops asking until Retry-After. `now` and `sleep` are
 * passed in for the tests.
 */
export class Pacer {
  private stamps: number[] = [];
  private blockedUntil = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly perMinute: number;
  private readonly gapMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(perMinute = 12, gapMs = 1000, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    this.perMinute = perMinute;
    this.gapMs = gapMs;
    this.now = now;
    this.sleep = sleep;
  }

  /** Milliseconds until the API may be asked again, from a 429's Retry-After. */
  blockedFor(): number {
    return Math.max(0, this.blockedUntil - this.now());
  }

  block(retryAfterSec: number): void {
    this.blockedUntil = this.now() + Math.max(1, Math.min(3600, retryAfterSec)) * 1000;
  }

  /** Runs `fn` when it's polite to, one at a time. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(async () => {
      for (;;) {
        const t = this.now();
        this.stamps = this.stamps.filter((s) => t - s < 60_000);
        const last = this.stamps[this.stamps.length - 1];
        let wait = last !== undefined ? Math.max(0, last + this.gapMs - t) : 0;
        if (this.stamps.length >= this.perMinute) wait = Math.max(wait, this.stamps[0] + 60_000 - t);
        if (wait <= 0) break;
        await this.sleep(wait);
      }
      this.stamps.push(this.now());
      return fn();
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
}
