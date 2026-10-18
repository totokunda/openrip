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

/**
 * Called with the menu bar's commands for the window: "about", "settings", "home",
 * "shortcuts", "notices", "layout:<id>" and "layout:reset". Returns an unsubscribe.
 */
export function onMenuCommand(cb: (cmd: string) => void): () => void {
  const listener = (_e: unknown, cmd: string) => cb(cmd);
  ipcRenderer.on("menu:command", listener);
  return () => ipcRenderer.off("menu:command", listener);
}

/** Tell the menu bar which screen shows and the keys Undo and Redo have (Electron accelerators). */
export function setMenuState(state: { view?: "home" | "editor"; undo?: string; redo?: string }): void {
  ipcRenderer.send("menu:set-state", state);
}
