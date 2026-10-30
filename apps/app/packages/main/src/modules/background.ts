import { app, type BrowserWindow } from "electron";

// Test runs (the smoke harness sets OPENRIP_BACKGROUND=1) open the app behind whatever the user
// is working on: no Dock icon or menu bar of its own, and windows shown without taking focus.
export const inBackground = process.env.OPENRIP_BACKGROUND === "1";

if (inBackground && process.platform === "darwin") app.setActivationPolicy("accessory");

export function showWindow(window: BrowserWindow) {
  if (inBackground) {
    window.showInactive();
    return;
  }
  window.show();
  window.focus();
}
