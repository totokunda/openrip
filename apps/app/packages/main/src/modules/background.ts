import { app, type BrowserWindow } from "electron";

// Test runs (the smoke harness sets OPENRIP_BACKGROUND=1) never show up on the user's screen: no
// Dock icon or menu bar of their own, and windows that are never put on screen at all. They still
// load, lay out and draw (`paintWhenInitiallyHidden`, background throttling off), and the harness
// drives the page and reads its pictures from the page, not the screen. If anything does put one
// on screen, it's fully transparent and lets every click through.
export const inBackground = process.env.OPENRIP_BACKGROUND === "1";

if (inBackground && process.platform === "darwin") app.setActivationPolicy("accessory");

/** A window "shown" in a test run: kept off screen, and invisible and click-through should anything show it. */
export function showUnseen(window: BrowserWindow) {
  window.setOpacity(0);
  window.setIgnoreMouseEvents(true);
}

export function showWindow(window: BrowserWindow) {
  if (inBackground) {
    showUnseen(window);
    return;
  }
  window.show();
  window.focus();
}
