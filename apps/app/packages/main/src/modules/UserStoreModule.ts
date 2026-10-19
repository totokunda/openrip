import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { ipcMain } from "electron";
import fsp from "node:fs/promises";
import { join } from "node:path";

/**
 * The user's own small lists that outlast a project and a window: favourites (effects, filters,
 * stickers, transitions, text templates, stock items, voice changer, adjustment presets), recent
 * searches. One JSON object, key to value, in `<userData>/user-store/store.json`. The renderer
 * owns what each value looks like (lib/user-store.ts); this keeps them, whole or not at all.
 * A per-viewer convenience (a remembered tab) stays in the browser's storage instead.
 */
const LIMIT = 16 * 1024 * 1024;

export class UserStoreModule implements AppModule {
  enable({ app }: ModuleContext): void {
    const dir = () => join(app.getPath("userData"), "user-store");
    const file = () => join(dir(), "store.json");
    let cache: Record<string, unknown> | null = null;
    let writing: Promise<unknown> = Promise.resolve();

    const load = async (): Promise<Record<string, unknown>> => {
      if (cache) return cache;
      try {
        const v = JSON.parse(await fsp.readFile(file(), "utf8"));
        cache = v && typeof v === "object" && !Array.isArray(v) ? v : {};
      } catch {
        cache = {};
      }
      return cache!;
    };

    const save = async (): Promise<boolean> => {
      const text = JSON.stringify(cache ?? {});
      if (text.length > LIMIT) return false;
      try {
        await fsp.mkdir(dir(), { recursive: true });
        const tmp = `${file()}.${process.pid}.part`;
        await fsp.writeFile(tmp, text, "utf8");
        await fsp.rename(tmp, file());
        return true;
      } catch {
        return false;
      }
    };

    // Every key and value saved so far.
    ipcMain.handle("userstore:read", async () => load());

    // Set one key (a value of null removes it).
    ipcMain.handle("userstore:set", async (_e, key: unknown, value: unknown): Promise<boolean> => {
      if (typeof key !== "string" || !key) return false;
      const all = await load();
      if (value == null) delete all[key];
      else all[key] = value;
      const done = writing.then(save, save);
      writing = done;
      return done;
    });
  }
}

export function userStoreModule() {
  return new UserStoreModule();
}
