import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { ipcMain, net } from "electron";
import fsp from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ALLOWED_LICENSES,
  FRESH_MS,
  Pacer,
  TRACK_ID,
  allowedHost,
  isAllowedLicense,
  searchKey,
  searchUrl,
  toTrack,
  type MusicTrack,
  type SearchRequest,
} from "./musicLibraryCore.js";

/**
 * The Audio tab's Music and Sound effects libraries, from Openverse (https://api.openverse.org,
 * which gathers the Creative Commons audio of Freesound, Jamendo, Wikimedia and others). No
 * account and no key: the anonymous tier, which allows 20 requests a minute and 200 a day, so:
 * - requests go one at a time, at most 12 a minute, and stop on a 429 until its Retry-After;
 * - a category's results are kept 6 hours, a typed search 30 minutes, in
 *   `<userData>/music-library/search/`; kept results older than that still answer when the
 *   network doesn't (offline, Openverse down or rate limiting us);
 * - every request says who is asking (User-Agent);
 * - only CC0, Public Domain Mark and CC BY tracks are listed (musicLibraryCore.ts says why).
 *
 * Tracks are downloaded the first time they're added (`files/<id>.<ext>` with the track's
 * details beside it as `<id>.json`); favourites are kept whole in `favorites.json`, and a
 * favourite is downloaded too, so both stay playable with no network.
 *
 * `OPENRIP_OPENVERSE_BASE=http://host:port` asks there instead (the automated tests' fixture
 * server; the pacing is off).
 */
const BASE = "https://api.openverse.org";
const USER_AGENT = "OpenRip/0.1 (open-source video editor; +https://github.com/totokunda/openrip)";

type Cached = { at: number; total: number; pageCount: number; tracks: MusicTrack[] };
export type MusicSearchResult =
  | { ok: true; tracks: MusicTrack[]; total: number; pageCount: number; stale: boolean }
  | { ok: false; error: string; offline: boolean; rateLimited: boolean };
type Failure = Extract<MusicSearchResult, { ok: false }>;
export type MusicFile = { ok: true; path: string; url: string } | { ok: false; error: string; offline: boolean };

const PARTS: Record<string, true> = { music: true, sfx: true };

/** A track from the renderer, checked as if it came from the API: only what it may be. */
const valid = (t: unknown, extra?: string): t is MusicTrack => {
  if (!t || typeof t !== "object") return false;
  const x = t as MusicTrack;
  return (
    typeof x.id === "string" &&
    TRACK_ID.test(x.id) &&
    PARTS[x.kind] === true &&
    isAllowedLicense(x.license) &&
    typeof x.url === "string" &&
    allowedHost(x.url, extra) &&
    /^[a-z0-9]{2,4}$/.test(x.ext) &&
    typeof x.title === "string" &&
    typeof x.author === "string" &&
    typeof x.durationSec === "number"
  );
};

export class MusicLibraryModule implements AppModule {
  enable({ app }: ModuleContext): void {
    const root = () => join(app.getPath("userData"), "music-library");
    const fixture = process.env.OPENRIP_OPENVERSE_BASE?.replace(/\/$/, "");
    const base = fixture ?? BASE;
    const pacer = fixture ? new Pacer(1e6, 0) : new Pacer();
    const inflight = new Map<string, Promise<MusicFile>>();

    const readJson = async <T>(path: string): Promise<T | null> => {
      try {
        return JSON.parse(await fsp.readFile(path, "utf8")) as T;
      } catch {
        return null;
      }
    };
    const writeJson = async (path: string, data: unknown) => {
      await fsp.mkdir(join(path, ".."), { recursive: true });
      const tmp = `${path}.${process.pid}.part`;
      await fsp.writeFile(tmp, JSON.stringify(data));
      await fsp.rename(tmp, path);
    };

    const fail = (error: string, offline = false, rateLimited = false): Failure => ({ ok: false, error, offline, rateLimited });

    ipcMain.handle("music:search", async (_e, req: SearchRequest): Promise<MusicSearchResult> => {
      if (!req || (req.kind !== "music" && req.kind !== "sfx")) return fail("bad request");
      const norm: SearchRequest = { kind: req.kind, q: typeof req.q === "string" ? req.q : undefined, page: Number(req.page) || 1, pageSize: 20 };
      const file = join(root(), "search", `${searchKey(norm)}.json`);
      const kept = await readJson<Cached>(file);
      const ttl = norm.q && !req.browse ? FRESH_MS.search : FRESH_MS.browse;
      if (kept && Date.now() - kept.at < ttl) return { ok: true, tracks: kept.tracks, total: kept.total, pageCount: kept.pageCount, stale: false };
      // Older kept results answer when the network can't.
      const fallback = (why: Failure): MusicSearchResult =>
        kept ? { ok: true, tracks: kept.tracks, total: kept.total, pageCount: kept.pageCount, stale: true } : why;
      if (pacer.blockedFor() > 0) return fallback(fail("Openverse is limiting requests right now. Try again in a few minutes.", false, true));
      try {
        const res = await pacer.run(() => net.fetch(searchUrl(base, norm), { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }));
        if (res.status === 429) {
          pacer.block(Number(res.headers.get("retry-after")) || 60);
          return fallback(fail("Openverse is limiting requests right now. Try again in a few minutes.", false, true));
        }
        if (!res.ok) return fallback(fail(`Openverse answered ${res.status}`));
        const body = (await res.json()) as { results?: unknown[]; result_count?: number; page_count?: number };
        const tracks = (body.results ?? []).map((r) => toTrack(r, norm.kind)).filter((t): t is MusicTrack => !!t);
        const out: Cached = { at: Date.now(), total: Number(body.result_count) || tracks.length, pageCount: Number(body.page_count) || 1, tracks };
        await writeJson(file, out).catch(() => undefined);
        return { ok: true, tracks, total: out.total, pageCount: out.pageCount, stale: false };
      } catch (e) {
        // fetch throws a TypeError when there's no connection at all.
        return fallback(fail(`Couldn't reach Openverse: ${(e as Error).message}`, true));
      }
    });

    const extFor = (t: MusicTrack) => `${t.id}.${t.ext}`;

    /** The files already here: track id to its path. */
    const cachedFiles = async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      try {
        for (const name of await fsp.readdir(join(root(), "files"))) {
          const m = /^([A-Za-z0-9-]+)\.([a-z0-9]{2,4})$/.exec(name);
          if (m && m[2] !== "json") out[m[1]] = join(root(), "files", name);
        }
      } catch {
        // none yet
      }
      return out;
    };

    const favorites = async () => (await readJson<MusicTrack[]>(join(root(), "favorites.json"))) ?? [];

    ipcMain.handle("music:state", async () => ({ cached: await cachedFiles(), favorites: (await favorites()).filter((t) => valid(t, fixture)) }));

    ipcMain.handle("music:download", (_e, t: unknown): Promise<MusicFile> => {
      if (!valid(t, fixture)) return Promise.resolve({ ok: false, error: "that isn't a track from the library", offline: false });
      const pending = inflight.get(t.id);
      if (pending) return pending;
      const job = (async (): Promise<MusicFile> => {
        const dest = join(root(), "files", extFor(t));
        try {
          await fsp.access(dest);
          return { ok: true, path: dest, url: pathToFileURL(dest).href };
        } catch {
          // not here yet
        }
        try {
          const res = await net.fetch(t.url, { headers: { "User-Agent": USER_AGENT } });
          if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}`, offline: false };
          const bytes = new Uint8Array(await res.arrayBuffer());
          await fsp.mkdir(join(root(), "files"), { recursive: true });
          // Whole or not at all: the player reads it as soon as it exists.
          const tmp = `${dest}.${process.pid}.part`;
          await fsp.writeFile(tmp, bytes);
          await writeJson(join(root(), "files", `${t.id}.json`), t);
          await fsp.rename(tmp, dest);
          return { ok: true, path: dest, url: pathToFileURL(dest).href };
        } catch (e) {
          return { ok: false, error: (e as Error).message, offline: (e as Error).name === "TypeError" || /ERR_INTERNET|ERR_NAME|ERR_CONNECTION|ERR_NETWORK/.test((e as Error).message) };
        }
      })().finally(() => inflight.delete(t.id));
      inflight.set(t.id, job);
      return job;
    });

    ipcMain.handle("music:favorite", async (_e, req: { track: unknown; on: boolean }): Promise<MusicTrack[]> => {
      const list = await favorites();
      if (!req || !valid(req.track, fixture)) return list;
      const rest = list.filter((t) => t.id !== (req.track as MusicTrack).id);
      const next = req.on ? [req.track as MusicTrack, ...rest] : rest;
      await writeJson(join(root(), "favorites.json"), next);
      return next;
    });

    ipcMain.handle("music:licenses", () => [...ALLOWED_LICENSES]);
  }
}

export function musicLibraryModule() {
  return new MusicLibraryModule();
}
