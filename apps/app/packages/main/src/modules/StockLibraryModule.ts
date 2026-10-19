import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { app, ipcMain, net, shell } from "electron";
import fsp from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  interleave,
  nasaPick,
  normalizeCommons,
  normalizeNasa,
  normalizeOpenverse,
  type StockItem,
  type StockKind,
  type StockSource,
} from "../../../renderer/src/lib/stock/sources.js";

/**
 * The Media tab's stock Library: searches of three openly licensed, key-free sources (Openverse
 * images, Wikimedia Commons videos and pictures, the NASA Image and Video Library; licences are
 * filtered in renderer/src/lib/stock/sources.ts) and the downloads into
 * `<userData>/stock/<id>.<ext>`.
 *
 * Polite to the services: every request names the app (Wikimedia's and Openverse's policies ask
 * for it), requests to one host go one at a time with a gap between them, a search's answer is
 * kept in memory and on disk for a day (Openverse allows an anonymous client 200 requests a
 * day), and a 429 stops that source for the time it asks for.
 *
 * `OPENRIP_STOCK_MIRROR=http://host:port` sends the searches to `<mirror>/openverse`,
 * `<mirror>/commons` and `<mirror>/nasa` instead of the real hosts and lets downloads come from
 * the mirror (the automated tests' local fixture server). Without it only https downloads from
 * public hosts are made.
 */
const USER_AGENT = "OpenRip/0.1 (open-source video editor; https://openrip.app; tkuye77@gmail.com)";
const GAP_MS: Record<StockSource, number> = { openverse: 1200, commons: 400, nasa: 400 };
const PAGE = 24;
const DAY = 86_400_000;
const ID = /^(openverse|commons|nasa)-[a-z0-9]{2,40}$/;
const EXT_OF: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type StockSearchReq = { kind: StockKind; query: string; page: number };
export type StockSearchRes =
  | { ok: true; items: StockItem[]; more: boolean; /** Sources that didn't answer (rate-limited or unreachable). */ missing: string[]; fromCache: boolean }
  | { ok: false; error: "offline" | "limited" | "failed"; message: string };
export type StockFile = { ok: true; path: string } | { ok: false; error: string };

type SourceAnswer = { items: StockItem[]; more: boolean };
class SourceError extends Error {
  constructor(
    readonly kind: "offline" | "limited" | "failed",
    message: string,
  ) {
    super(message);
  }
}

const privateHost = (h: string) => /^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^[\d.]+$/.test(h) || h.includes(":");

export class StockLibraryModule implements AppModule {
  enable(_ctx: ModuleContext): void {
    const dir = () => join(app.getPath("userData"), "stock");
    const mirror = () => (process.env.OPENRIP_STOCK_MIRROR ?? "").replace(/\/$/, "");

    // ---- polite fetching ----
    const lastAt: Partial<Record<StockSource, number>> = {};
    const chain: Partial<Record<StockSource, Promise<unknown>>> = {};
    const blockedUntil: Partial<Record<StockSource, number>> = {};

    /** One request at a time per source, with a gap; answers with the JSON. */
    const getJson = (source: StockSource, url: string): Promise<any> => {
      const run = async () => {
        const wait = (lastAt[source] ?? 0) + GAP_MS[source] - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if ((blockedUntil[source] ?? 0) > Date.now()) throw new SourceError("limited", `${source} asked us to slow down`);
        lastAt[source] = Date.now();
        let res: Response;
        try {
          res = await net.fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        } catch (e) {
          throw new SourceError("offline", (e as Error).message);
        }
        if (res.status === 429 || res.status === 503) {
          const after = Number(res.headers.get("retry-after"));
          blockedUntil[source] = Date.now() + (Number.isFinite(after) && after > 0 ? Math.min(after, 3600) * 1000 : 60_000);
          throw new SourceError("limited", `${res.status}`);
        }
        if (!res.ok) throw new SourceError("failed", `${res.status} ${res.statusText}`);
        try {
          return await res.json();
        } catch {
          throw new SourceError("failed", "unreadable answer");
        }
      };
      const next = (chain[source] ?? Promise.resolve()).then(run, run);
      chain[source] = next.catch(() => undefined);
      return next;
    };

    const base = (source: StockSource, real: string) => (mirror() ? `${mirror()}/${source}` : real);

    // ---- the three sources ----
    const openverse = async (q: string, page: number): Promise<SourceAnswer> => {
      const p = new URLSearchParams({ q, license: "cc0,pdm,by", page_size: "20", page: String(page), mature: "false", extension: "jpg,jpeg,png,webp" });
      const j = await getJson("openverse", `${base("openverse", "https://api.openverse.org")}/v1/images/?${p}`);
      const items = (Array.isArray(j?.results) ? j.results : []).map(normalizeOpenverse).filter((x: StockItem | null): x is StockItem => !!x);
      return { items, more: Number(j?.page_count) > page };
    };

    const commons = async (q: string, kind: StockKind, page: number): Promise<SourceAnswer> => {
      const p = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        generator: "search",
        gsrsearch: `${q} filetype:${kind === "video" ? "video" : "bitmap"}`,
        gsrnamespace: "6",
        gsrlimit: String(PAGE),
        gsroffset: String((page - 1) * PAGE),
        prop: "imageinfo",
        iiprop: "url|size|mime|mediatype|extmetadata|derivatives|metadata",
        iiurlwidth: "330",
        iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|ObjectName|Restrictions",
        origin: "*",
      });
      const j = await getJson("commons", `${base("commons", "https://commons.wikimedia.org")}/w/api.php?${p}`);
      const pages: any[] = Array.isArray(j?.query?.pages) ? j.query.pages : [];
      // The generator's order is the search's (`index`).
      pages.sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0));
      const items = pages.map((pg) => normalizeCommons(pg, kind)).filter((x): x is StockItem => !!x);
      return { items, more: !!j?.continue };
    };

    const nasa = async (q: string, kind: StockKind, page: number): Promise<SourceAnswer> => {
      const p = new URLSearchParams({ q, media_type: kind === "video" ? "video" : "image", page_size: "20", page: String(page) });
      const j = await getJson("nasa", `${base("nasa", "https://images-api.nasa.gov")}/search?${p}`);
      const list: any[] = Array.isArray(j?.collection?.items) ? j.collection.items : [];
      const items = list.map((it) => normalizeNasa(it, kind === "video" ? "video" : "photo")).filter((x): x is StockItem => !!x);
      return { items, more: !!(j?.collection?.links ?? []).find((l: any) => l?.rel === "next") };
    };

    // ---- search, with a day's cache ----
    const memory = new Map<string, { at: number; value: Extract<StockSearchRes, { ok: true }> }>();
    const diskFile = () => join(dir(), "searches.json");
    let disk: Record<string, { at: number; value: Extract<StockSearchRes, { ok: true }> }> | null = null;
    const readDisk = async () => {
      if (disk) return disk;
      try {
        disk = JSON.parse(await fsp.readFile(diskFile(), "utf8"));
      } catch {
        disk = {};
      }
      return disk!;
    };
    const writeDisk = async () => {
      try {
        const d = await readDisk();
        // Keep the newest 200 answers.
        const keys = Object.keys(d).sort((a, b) => d[b].at - d[a].at);
        for (const k of keys.slice(200)) delete d[k];
        await fsp.mkdir(dir(), { recursive: true });
        await fsp.writeFile(diskFile(), JSON.stringify(d), "utf8");
      } catch {
        // the cache is a courtesy
      }
    };

    const search = async (req: StockSearchReq): Promise<StockSearchRes> => {
      const kind: StockKind = req?.kind === "photo" ? "photo" : "video";
      const query = String(req?.query ?? "").trim().slice(0, 120);
      const page = Math.max(1, Math.min(50, Math.floor(Number(req?.page)) || 1));
      if (!query) return { ok: true, items: [], more: false, missing: [], fromCache: false };
      const key = `${mirror()}|${kind}|${query.toLowerCase()}|${page}`;
      const hit = memory.get(key) ?? (await readDisk())[key];
      if (hit && Date.now() - hit.at < DAY) return { ...hit.value, fromCache: true };

      const jobs: [StockSource, Promise<SourceAnswer>][] =
        kind === "video"
          ? [
              ["commons", commons(query, "video", page)],
              ["nasa", nasa(query, "video", page)],
            ]
          : [
              ["openverse", openverse(query, page)],
              ["commons", commons(query, "photo", page)],
              ["nasa", nasa(query, "photo", page)],
            ];
      const settled = await Promise.allSettled(jobs.map(([, p]) => p));
      const answers: SourceAnswer[] = [];
      const errors: SourceError[] = [];
      const missing: string[] = [];
      settled.forEach((s, i) => {
        if (s.status === "fulfilled") answers.push(s.value);
        else {
          errors.push(s.reason instanceof SourceError ? s.reason : new SourceError("failed", String(s.reason)));
          missing.push(jobs[i][0]);
        }
      });
      if (answers.length === 0) {
        const kindOf = errors.some((e) => e.kind === "offline") ? "offline" : errors.some((e) => e.kind === "limited") ? "limited" : "failed";
        return {
          ok: false,
          error: kindOf,
          message: kindOf === "offline" ? "You're offline. Connect to the internet to browse the library." : kindOf === "limited" ? "The libraries asked for a short break. Try again in a minute." : "The libraries didn't answer. Try again in a moment.",
        };
      }
      // A repeat of the same file (the same address from two sources) shows once.
      const seen = new Set<string>();
      const items = interleave(answers.map((a) => a.items)).filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true)));
      const value = { ok: true as const, items, more: answers.some((a) => a.more), missing, fromCache: false };
      // Only a complete answer is worth keeping.
      if (missing.length === 0) {
        memory.set(key, { at: Date.now(), value });
        (await readDisk())[key] = { at: Date.now(), value };
        void writeDisk();
      }
      return value;
    };

    ipcMain.handle("stock:search", async (_e, req: StockSearchReq): Promise<StockSearchRes> => {
      try {
        return await search(req);
      } catch (e) {
        return { ok: false, error: "failed", message: (e as Error).message };
      }
    });

    // A credit's links (the licence, the author, the source page) open in the browser.
    ipcMain.handle("stock:open-url", async (_e, url: string) => {
      try {
        const u = new URL(String(url));
        if (u.protocol === "https:") await shell.openExternal(u.href);
      } catch {
        // not an address
      }
    });

    // ---- downloads ----
    ipcMain.handle("stock:cached", async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      try {
        for (const name of await fsp.readdir(dir())) {
          const m = /^((?:openverse|commons|nasa)-[a-z0-9]+)\.(mp4|webm|jpg|png|webp)$/.exec(name);
          if (m) out[m[1]] = join(dir(), name);
        }
      } catch {
        // none yet
      }
      return out;
    });

    const allowed = (u: URL): boolean => {
      const m = mirror();
      if (m) return u.origin === new URL(m).origin;
      return u.protocol === "https:" && !privateHost(u.hostname);
    };

    /** NASA's file for an asset id: its manifest lists every rendition. */
    const nasaFile = async (nid: string, kind: StockKind): Promise<string> => {
      const j = await getJson("nasa", `${base("nasa", "https://images-api.nasa.gov")}/asset/${encodeURIComponent(nid)}`);
      const hrefs: string[] = (Array.isArray(j?.collection?.items) ? j.collection.items : []).map((i: any) => String(i?.href ?? ""));
      const file = nasaPick(hrefs, kind);
      if (!file) throw new SourceError("failed", "NASA has no file for it");
      return file;
    };

    const inflight = new Map<string, Promise<StockFile>>();
    const fetchTo = async (id: string, kind: StockKind, url: string): Promise<StockFile> => {
      const u = new URL(url);
      if (!allowed(u)) return { ok: false, error: "that address isn't a stock source" };
      let res: Response;
      try {
        res = await net.fetch(u.href, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10 * 60_000) });
      } catch (e) {
        return { ok: false, error: `offline: ${(e as Error).message}` };
      }
      if (!res.ok || !res.body) return { ok: false, error: `${res.status} ${res.statusText}` };
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const ext = EXT_OF[type];
      if (!ext || (kind === "video") !== type.startsWith("video/")) return { ok: false, error: `not a ${kind === "video" ? "video" : "photo"} this app can use (${type || "unknown type"})` };
      const cap = kind === "video" ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > cap) return { ok: false, error: "that file is too big" };
      await fsp.mkdir(dir(), { recursive: true });
      const path = join(dir(), `${id}.${ext}`);
      const tmp = `${path}.${process.pid}.part`;
      let bytes = 0;
      const source = Readable.fromWeb(res.body as any);
      source.on("data", (c: Buffer) => {
        bytes += c.length;
        if (bytes > cap) source.destroy(new Error("that file is too big"));
      });
      try {
        await pipeline(source, createWriteStream(tmp));
        // Whole or not at all: the tile and the importer read it as soon as it exists.
        await fsp.rename(tmp, path);
      } catch (e) {
        await fsp.rm(tmp, { force: true });
        return { ok: false, error: (e as Error).message };
      }
      return { ok: true, path };
    };

    ipcMain.handle("stock:download", (_e, req: { id: string; kind: StockKind; url: string }): Promise<StockFile> => {
      if (typeof req?.id !== "string" || !ID.test(req.id) || typeof req.url !== "string" || (req.kind !== "video" && req.kind !== "photo")) return Promise.resolve({ ok: false, error: "bad request" });
      const pending = inflight.get(req.id);
      if (pending) return pending;
      const job = (async (): Promise<StockFile> => {
        try {
          const url = req.url.startsWith("nasa-asset:") ? await nasaFile(req.url.slice("nasa-asset:".length), req.kind) : req.url;
          return await fetchTo(req.id, req.kind, url);
        } catch (e) {
          return { ok: false, error: e instanceof SourceError && e.kind === "offline" ? `offline: ${e.message}` : (e as Error).message };
        }
      })().finally(() => inflight.delete(req.id));
      inflight.set(req.id, job);
      return job;
    });
  }
}

export function stockLibraryModule() {
  return new StockLibraryModule();
}
