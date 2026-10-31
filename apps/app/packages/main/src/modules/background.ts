import { app, type BrowserWindow } from "electron";

// Test runs (the smoke harness sets OPENRIP_BACKGROUND=1) never show up on the user's screen:
// no Dock icon or menu bar of their own, and windows that are on (so they draw and play as
// usual) but fully transparent, never focused, and letting every click through to whatever is
// under them. The harness drives the page itself and reads its pictures from the page, not the
// screen.
export const inBackground = process.env.OPENRIP_BACKGROUND === "1";

if (inBackground && process.platform === "darwin") app.setActivationPolicy("accessory");

/** Shows a window without it being seen or taking focus. */
export function showUnseen(window: BrowserWindow) {
  window.setOpacity(0);
  window.setIgnoreMouseEvents(true);
  window.showInactive();
}

export function showWindow(window: BrowserWindow) {
  if (inBackground) {
    showUnseen(window);
    return;
  }
  window.show();
  window.focus();
}
