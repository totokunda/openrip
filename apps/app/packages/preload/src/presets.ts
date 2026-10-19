import { ipcRenderer } from "electron";

/**
 * Media › Yours › My presets (the main process's ClipPresetsModule): the saved clip presets, one
 * JSON file in `<userData>/clip-presets/`. The renderer reads and writes it whole (its shape is
 * lib/clip-preset-data.ts's).
 */

/** The file's text, or null when nothing was saved yet. */
export function clipPresetsRead(): Promise<string | null> {
  return ipcRenderer.invoke("presets:read");
}

/** Replace the file; false when it couldn't be written. */
export function clipPresetsWrite(text: string): Promise<boolean> {
  return ipcRenderer.invoke("presets:write", text);
}
