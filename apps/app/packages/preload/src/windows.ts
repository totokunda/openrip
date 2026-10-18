import { ipcRenderer } from "electron";

/**
 * The editor's panels in windows of their own (main's PanelWindows, the renderer's
 * lib/panel-windows.ts). The page opens them with `window.open`; main places them and
 * remembers where they were.
 */

/**
 * Called with a panel window's name when the user closes it (its close button), not when the
 * page closes it or the app quits. Returns an unsubscribe.
 */
export function onPanelWindowClosed(cb: (name: string) => void): () => void {
  const listener = (_e: unknown, name: string) => cb(name);
  ipcRenderer.on("panel-window:closed", listener);
  return () => ipcRenderer.off("panel-window:closed", listener);
}

/** Move a panel window's top-left to (x, y) in screen coordinates (while it's dragged out). */
export function movePanelWindow(name: string, x: number, y: number): void {
  ipcRenderer.send("panel-window:move", name, Math.round(x), Math.round(y));
}
