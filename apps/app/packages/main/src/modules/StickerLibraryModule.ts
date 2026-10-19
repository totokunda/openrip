import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { ipcMain, net } from "electron";
import fsp from "node:fs/promises";
import { join } from "node:path";

/**
 * The Stickers tab's files. The sets' pictures (Fluent Emoji, Noto Emoji, the animated Noto
 * emoji) are downloaded the first time a sticker is used, from the source repositories' raw
 * files, into `<userData>/stickers/<id>.<ext>`; the starter set shipped in the app is copied
 * there the same way (the renderer reads it and hands the bytes over). The engine draws a
 * sticker clip from that file. The manifest (id, name, keywords, category, URL, licence) is
 * shipped in the renderer's public folder, made by scripts/build-sticker-manifest.mjs.
 *
 * `OPENRIP_STICKER_MIRROR=http://host:port` fetches from there instead of the real hosts (the
 * automated tests' local fixture server).
 */
const HOSTS = new Set(["raw.githubusercontent.com", "fonts.gstatic.com"]);
const EXTS = new Set(["png", "svg", "webp", "gif"]);
const ID = /^[a-z0-9][a-z0-9-]{0,120}$/;

type Ensured = { ok: true; path: string } | { ok: false; error: string };

export class StickerLibraryModule implements AppModule {
  enable({ app }: ModuleContext): void {
    const dir = () => join(app.getPath("userData"), "stickers");
    const inflight = new Map<string, Promise<Ensured>>();

    const valid = (id: unknown, ext: unknown): id is string => typeof id === "string" && ID.test(id) && typeof ext === "string" && EXTS.has(ext);

    /** The files already here: sticker id to its path. */
    ipcMain.handle("stickers:cached", async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      try {
        for (const name of await fsp.readdir(dir())) {
          const m = /^([a-z0-9-]+)\.(png|svg|webp|gif)$/.exec(name);
          if (m) out[m[1]] = join(dir(), name);
        }
      } catch {
        // none yet
      }
      return out;
    });

    const write = async (id: string, ext: string, bytes: Uint8Array): Promise<Ensured> => {
      await fsp.mkdir(dir(), { recursive: true });
      const path = join(dir(), `${id}.${ext}`);
      // Whole or not at all: the engine and the tiles read it as soon as it exists.
      const tmp = `${path}.${process.pid}.part`;
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, path);
      return { ok: true, path };
    };

    ipcMain.handle("stickers:store", async (_e, req: { id: string; ext: string; bytes: Uint8Array }): Promise<Ensured> => {
      if (!valid(req?.id, req?.ext) || !(req.bytes instanceof Uint8Array)) return { ok: false, error: "bad sticker" };
      try {
        return await write(req.id, req.ext, req.bytes);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    });

    ipcMain.handle("stickers:download", (_e, req: { id: string; ext: string; url: string }): Promise<Ensured> => {
      if (!valid(req?.id, req?.ext) || typeof req.url !== "string") return Promise.resolve({ ok: false, error: "bad sticker" });
      const pending = inflight.get(req.id);
      if (pending) return pending;
      const job = (async (): Promise<Ensured> => {
        try {
          const u = new URL(req.url);
          const mirror = process.env.OPENRIP_STICKER_MIRROR;
          if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) return { ok: false, error: "that host isn't a sticker source" };
          const res = await net.fetch(mirror ? `${mirror.replace(/\/$/, "")}${u.pathname}` : u.href);
          if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
          return await write(req.id, req.ext, new Uint8Array(await res.arrayBuffer()));
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      })().finally(() => inflight.delete(req.id));
      inflight.set(req.id, job);
      return job;
    });
  }
}

export function stickerLibraryModule() {
  return new StickerLibraryModule();
}
