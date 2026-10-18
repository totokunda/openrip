import { ipcRenderer } from "electron";

/**
 * Called when Edit ▸ Undo or Redo is chosen in the menu bar (main's AppMenu). Returns an
 * unsubscribe.
 */
export function onMenuEdit(cb: (cmd: "undo" | "redo") => void): () => void {
  const listener = (_e: unknown, cmd: "undo" | "redo") => cb(cmd);
  ipcRenderer.on("menu:edit", listener);
  return () => ipcRenderer.off("menu:edit", listener);
}
