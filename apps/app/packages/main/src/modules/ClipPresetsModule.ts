import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { ipcMain } from "electron";
import fsp from "node:fs/promises";
import { join } from "node:path";
import { getSettingsModule } from "./SettingsModule.js";

/**
 * Media › Yours › My presets: the clip presets the user saved (the Save preset item of a clip's
 * menu), kept as one JSON file in `<userData>/clip-presets/presets.json`, so they outlast the
 * project and the window. The renderer owns the file's shape (lib/clip-preset-data.ts) and
 * hands the whole list over to be written; this only reads and writes it, whole or not at all.
 */
const LIMIT = 32 * 1024 * 1024;

export class ClipPresetsModule implements AppModule {
  enable({ app }: ModuleContext): void {
    // Settings › Draft › Preset save path, else `<userData>/clip-presets`.
    const dir = () => getSettingsModule().getPreferences().presetsDir || join(app.getPath("userData"), "clip-presets");
    const file = () => join(dir(), "presets.json");

    // A new folder starts with the presets the old one had (unless it already holds some).
    let moving: Promise<void> = Promise.resolve();
    getSettingsModule().on("preferences-changed", (next: { presetsDir: string }, before: { presetsDir: string }) => {
      if (next.presetsDir === before.presetsDir) return;
      moving = move(next, before);
    });
    const move = async (next: { presetsDir: string }, before: { presetsDir: string }) => {
      const from = join(before.presetsDir || join(app.getPath("userData"), "clip-presets"), "presets.json");
      const to = join(next.presetsDir || join(app.getPath("userData"), "clip-presets"), "presets.json");
      try {
        await fsp.access(to);
      } catch {
        try {
          await fsp.mkdir(join(to, ".."), { recursive: true });
          await fsp.copyFile(from, to);
        } catch {
          // nothing to carry over
        }
      }
    };

    // The file's text, or null when there is none yet.
    ipcMain.handle("presets:read", async (): Promise<string | null> => {
      await moving;
      try {
        return await fsp.readFile(file(), "utf8");
      } catch {
        return null;
      }
    });

    ipcMain.handle("presets:write", async (_e, text: unknown): Promise<boolean> => {
      if (typeof text !== "string" || text.length > LIMIT) return false;
      await moving;
      try {
        await fsp.mkdir(dir(), { recursive: true });
        const tmp = `${file()}.${process.pid}.part`;
        await fsp.writeFile(tmp, text, "utf8");
        await fsp.rename(tmp, file());
        return true;
      } catch {
        return false;
      }
    });
  }
}

export function clipPresetsModule() {
  return new ClipPresetsModule();
}
