/**
 * The editor's panels in windows of their own. The page opens one with
 * `window.open("", "openrip-panel:<panel>:<n>")` and renders the panel into it itself
 * (renderer lib/panel-windows.ts); here each window is given its frame and placed:
 *
 * - where the page asks (a header dragged out of the editor: its top-left under the pointer),
 *   else where that panel's window was last time (kept per panel in panel-windows.json in the
 *   profile), else, for the player, on another display than the editor's when there is one
 *   (the player on a second screen while editing on the first), else beside the editor;
 * - always on a screen: a place left on a display that's gone comes back onto the nearest one,
 *   at open and when displays change.
 *
 * The user closing a panel window docks its panel (the page is told). The editor's window
 * closing closes them; quitting leaves the panels out for the next session.
 */
import { app, BrowserWindow, ipcMain, screen, type Rectangle } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PanelId = "assets" | "player" | "inspector" | "timeline";
const PANELS: PanelId[] = ["assets", "player", "inspector", "timeline"];
const TITLES: Record<PanelId, string> = { assets: "Media", player: "Player", inspector: "Inspector", timeline: "Timeline" };
/** First-time sizes, and the smallest each window can be. */
const DEFAULT_SIZE: Record<PanelId, [number, number]> = { assets: [560, 680], player: [960, 620], inspector: [420, 720], timeline: [1200, 460] };
const MIN_SIZE: Record<PanelId, [number, number]> = { assets: [360, 320], player: [400, 300], inspector: [320, 360], timeline: [640, 240] };

type Saved = { x: number; y: number; width: number; height: number; maximized?: boolean };
const PREFIX = "openrip-panel:";
const panelOf = (frameName: string): PanelId | null => {
  if (!frameName.startsWith(PREFIX)) return null;
  const id = frameName.slice(PREFIX.length).split(":")[0] as PanelId;
  return PANELS.includes(id) ? id : null;
};

let saved: Partial<Record<PanelId, Saved>> | null = null;
const storePath = () => join(app.getPath("userData"), "panel-windows.json");
function places(): Partial<Record<PanelId, Saved>> {
  if (saved) return saved;
  try {
    saved = existsSync(storePath()) ? JSON.parse(readFileSync(storePath(), "utf8")) : {};
  } catch {
    saved = {};
  }
  return saved!;
}
let writeTimer: ReturnType<typeof setTimeout> | null = null;
function remember(panel: PanelId, win: BrowserWindow, now = false) {
  if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
  const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  places()[panel] = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
  if (writeTimer) clearTimeout(writeTimer);
  const write = () => {
    writeTimer = null;
    try {
      writeFileSync(storePath(), JSON.stringify(places(), null, 2));
    } catch (e) {
      console.warn("[panel-windows] couldn't save places:", e);
    }
  };
  if (now) write();
  else writeTimer = setTimeout(write, 300);
}

/** `rect` moved and sized to lie wholly on the work area of the display it's most on (or nearest). */
export function onScreen(rect: Rectangle, min: [number, number] = [200, 150]): Rectangle {
  const area = screen.getDisplayMatching(rect).workArea;
  const width = Math.max(Math.min(rect.width, area.width), Math.min(min[0], area.width));
  const height = Math.max(Math.min(rect.height, area.height), Math.min(min[1], area.height));
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** `left=…,top=…` from window.open's features. */
function featurePoint(features: string): { x: number; y: number } | null {
  const get = (k: string) => {
    const m = new RegExp(`(?:^|,)\\s*${k}\\s*=\\s*(-?\\d+)`).exec(features);
    return m ? Number(m[1]) : null;
  };
  const [x, y] = [get("left"), get("top")];
  return x == null || y == null ? null : { x, y };
}

function placement(panel: PanelId, features: string, editor: BrowserWindow): Rectangle {
  const last = places()[panel];
  const [w, h] = last ? [last.width, last.height] : DEFAULT_SIZE[panel];
  const at = featurePoint(features);
  if (at) return onScreen({ x: at.x, y: at.y, width: w, height: h }, MIN_SIZE[panel]);
  if (last) return onScreen(last, MIN_SIZE[panel]);
  const home = screen.getDisplayMatching(editor.getBounds());
  const other = panel === "player" ? screen.getAllDisplays().find((d) => d.id !== home.id) : undefined;
  const area = (other ?? home).workArea;
  // On a screen of its own the player takes most of it.
  const [width, height] = other ? [Math.round(area.width * 0.7), Math.round(area.height * 0.7)] : [Math.min(w, area.width), Math.min(h, area.height)];
  return onScreen({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height }, MIN_SIZE[panel]);
}

let quitting = false;
let wired = false;
/** Each panel window and the editor window it belongs to. */
const owners = new Map<BrowserWindow, BrowserWindow>();
const byName = new Map<string, BrowserWindow>();

/** The editor window a window belongs to: itself, or the editor of a panel window. */
export function editorWindowFor(win: BrowserWindow | null | undefined): BrowserWindow | null {
  if (!win || win.isDestroyed()) return null;
  const owner = owners.get(win);
  return owner && !owner.isDestroyed() ? owner : win;
}

function wireOnce() {
  if (wired) return;
  wired = true;
  app.on("before-quit", () => (quitting = true));
  // While a header is dragged out, its new window follows the pointer.
  ipcMain.on("panel-window:move", (_e, name: string, x: number, y: number) => {
    const win = byName.get(name);
    if (win && !win.isDestroyed() && Number.isFinite(x) && Number.isFinite(y)) win.setPosition(Math.round(x), Math.round(y));
  });
  // A display unplugged or rearranged: windows left off-screen come back.
  const refit = () => {
    for (const [win] of owners) {
      if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) continue;
      const b = win.getBounds();
      const fit = onScreen(b);
      if (fit.x !== b.x || fit.y !== b.y || fit.width !== b.width || fit.height !== b.height) win.setBounds(fit);
    }
  };
  screen.on("display-removed", refit);
  screen.on("display-metrics-changed", refit);
}

/** Let the editor window open its panels' windows (and nothing else). */
export function attachPanelWindows(editor: BrowserWindow) {
  wireOnce();
  let editorClosing = false;
  const mac = process.platform === "darwin";
  const win32 = process.platform === "win32";
  editor.webContents.setWindowOpenHandler(({ frameName, features }) => {
    const panel = panelOf(frameName);
    if (!panel) return { action: "deny" };
    const { x, y, width, height } = placement(panel, features, editor);
    const [minWidth, minHeight] = MIN_SIZE[panel];
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        x,
        y,
        width,
        height,
        minWidth,
        minHeight,
        title: `${TITLES[panel]} — OpenRip`,
        backgroundColor: "#141414",
        // On macOS shown once it can be beside a full-screen editor (did-create-window).
        show: !mac,
        // The editor itself may be full screen; its panels' windows never start so.
        fullscreen: false,
        fullscreenable: true,
        autoHideMenuBar: true,
        // CapCut's dark window chrome: the page draws a 34 px title strip under the window's
        // own buttons (macOS's lights, Windows' overlay).
        titleBarStyle: "hidden",
        // Its own window, never a tab of the editor's (macOS makes new windows tabs of a full
        // screen window by default).
        ...(mac ? { trafficLightPosition: { x: 12, y: 11 }, tabbingIdentifier: frameName } : {}),
        ...(win32 || !mac ? { titleBarOverlay: { color: "#141414", symbolColor: "#e0e0e0", height: 34 } } : {}),
        webPreferences: { backgroundThrottling: false, spellcheck: false },
      },
    };
  });
  editor.webContents.on("did-create-window", (child, { frameName }) => {
    const panel = panelOf(frameName);
    if (!panel) return;
    owners.set(child, editor);
    byName.set(frameName, child);
    if (mac) {
      // The editor starts full screen on macOS, in a Space of its own. A window opening on
      // another display is an ordinary window there (the player on a second screen). One on
      // the editor's display would become a full-screen tab of it, or open in another Space
      // out of sight: the editor leaves full screen first (maximized, as CapCut's window is)
      // and the panel's window opens beside it.
      const sameDisplay = screen.getDisplayMatching(child.getBounds()).id === screen.getDisplayMatching(editor.getBounds()).id;
      if (editor.isFullScreen() && sameDisplay) {
        const show = () => {
          clearTimeout(fallback);
          if (!editor.isDestroyed() && !editor.isFullScreen()) editor.maximize();
          if (!child.isDestroyed() && !child.isVisible()) child.show();
        };
        const fallback = setTimeout(show, 2000);
        editor.once("leave-full-screen", show);
        editor.setFullScreen(false);
      } else {
        child.show();
      }
    }
    if (places()[panel]?.maximized) child.maximize();
    const save = () => remember(panel, child);
    child.on("moved", save);
    child.on("resized", save);
    child.on("maximize", save);
    child.on("unmaximize", save);
    child.on("close", () => {
      remember(panel, child, true);
      // The user closed it: its panel goes back into the editor. Not when the editor or the
      // app is going (the panel stays out for next time).
      if (!quitting && !editorClosing && !editor.isDestroyed()) editor.webContents.send("panel-window:closed", frameName);
    });
    child.on("closed", () => {
      owners.delete(child);
      if (byName.get(frameName) === child) byName.delete(frameName);
    });
  });
  editor.on("close", () => (editorClosing = true));
  // Its panels' windows go with it.
  editor.on("closed", () => {
    for (const [child, owner] of owners) {
      if (owner === editor && !child.isDestroyed()) child.destroy();
    }
  });
}
