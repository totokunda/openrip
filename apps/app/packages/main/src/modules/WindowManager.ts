import type { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { app, BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppInitConfig } from "../AppInitConfig.js";
import { attachPanelWindows } from "./PanelWindows.js";

class WindowManager implements AppModule {
  readonly #preload: { path: string };
  readonly #renderer: { path: string } | URL;
  readonly #openDevTools: boolean;
  #mainWindow: BrowserWindow | null = null;

  constructor({
    initConfig,
    openDevTools = false,
  }: {
    initConfig: AppInitConfig;
    openDevTools?: boolean;
  }) {
    this.#preload = initConfig.preload;
    this.#renderer = initConfig.renderer;
    this.#openDevTools = Boolean(openDevTools);
  }

  async enable({ app }: ModuleContext): Promise<void> {
    await app.whenReady();
    try {
      await this.restoreOrCreateMainWindow(true);
    } catch (error) {
      console.error("[WindowManager] Failed to create/show window:", error);
    }
    app.on("second-instance", () => void this.restoreOrCreateMainWindow(true));
    app.on("activate", () => void this.restoreOrCreateMainWindow(true));
  }

  #wireReadyToShow(browserWindow: BrowserWindow) {
    browserWindow.once("ready-to-show", () => {
      if (browserWindow.isDestroyed()) return;
      browserWindow.show();
      browserWindow.focus();
    });
  }

  #applyWindowsTopbarFixes(browserWindow: BrowserWindow) {
    // Windows native title bars often default to a light theme; use an overlay so the topbar stays black.
    if (process.platform !== "win32") return;
    try {
      // `setTitleBarOverlay` exists on newer Electron; fall back to constructor options if unavailable.
      browserWindow.setTitleBarOverlay?.({
        color: "#000000",
        symbolColor: "#FFFFFF",
      });
    } catch {
      // ignore
    }
  }

  #enableWindowsFullscreenEscapeHatch(browserWindow: BrowserWindow) {
    if (process.platform !== "win32") return;
    // Ensure users can always exit fullscreen on Windows even if the renderer swallows keys.
    browserWindow.webContents.on("before-input-event", (_event, input) => {
      if (browserWindow.isDestroyed()) return;
      if (!browserWindow.isFullScreen()) return;

      const key = input.key;
      const isKeyDown = input.type === "keyDown";
      if (!isKeyDown) return;

      // Common fullscreen exit keys.
      if (key === "Escape" || key === "F11") {
        browserWindow.setFullScreen(false);
      }
    });
  }

  async #loadRenderer(browserWindow: BrowserWindow) {
    try {
      if (this.#renderer instanceof URL) {
        await browserWindow.loadURL(this.#renderer.href);
      } else {
        await browserWindow.loadFile(this.#renderer.path);
      }
    } catch (error) {
      console.error("[WindowManager] Failed to load renderer:", error);
    }
  }

  async createMainWindow(): Promise<BrowserWindow> {
    // A packaged app takes its icon from the bundle; in development the Dock (and on Windows
    // and Linux the window) would show Electron's, so give them the app's.
    const icon = app.isPackaged ? undefined : devIcon();
    if (icon && process.platform === "darwin") app.dock?.setIcon(icon);
    const browserWindow = new BrowserWindow({
      show: false,
      ...(icon ? { icon } : {}),
      backgroundColor: "#000000",
      ...(process.platform === "win32"
        ? {
            // Don't force fullscreen on Windows: it can feel "stuck" and obscure exit affordances.
            // Start maximized instead.
            fullscreen: false,
            autoHideMenuBar: true,
          }
        : { fullscreen: true }),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webviewTag: false,
        // Video editor UX: avoid Chromium throttling when the window is briefly occluded / unfocused.
        // (Helps keep preview playback smooth on some platforms/GPUs.)
        backgroundThrottling: false,
        // Avoid spellcheck overhead in a performance-sensitive surface.
        spellcheck: false,
        // Improve startup by enabling V8 code caching where supported.
        v8CacheOptions: "code",
        preload: this.#preload.path,
      },
    });
    this.#enableWindowsFullscreenEscapeHatch(browserWindow);
    // The editor's panels can open in windows of their own.
    attachPanelWindows(browserWindow);
    if (process.platform === "win32") {
      try {
        browserWindow.setMenuBarVisibility(false);
      } catch {
        // ignore
      }
    }
    this.#wireReadyToShow(browserWindow);
    await this.#loadRenderer(browserWindow);
    if (this.#openDevTools) {
      try {
        browserWindow.webContents.openDevTools({ mode: "detach" });
      } catch {
        // ignore
      }
    }

    // Ensure background throttling is disabled even if Electron defaults change.
    try {
      browserWindow.webContents.setBackgroundThrottling(false);
    } catch {
      // ignore
    }

    if (process.platform === "win32") {
      try {
        browserWindow.maximize();
      } catch {
        // ignore
      }
    }

    browserWindow.on("closed", () => {
      if (this.#mainWindow === browserWindow) {
        this.#mainWindow = null;
      }
    });

    return browserWindow;
  }

  async restoreOrCreateMainWindow(show = false) {
    let window = this.#mainWindow;
    if (!window || window.isDestroyed()) {
      window = await this.createMainWindow();
      this.#mainWindow = window;
    }

    if (!show) {
      return window;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window?.show();
    window.focus();
    return window;
  }
}

export function createWindowManagerModule(
  ...args: ConstructorParameters<typeof WindowManager>
) {
  return new WindowManager(...args);
}

/** apps/app/buildResources/icon.png, looked for upwards from the app path (`npm start` runs from packages/). */
function devIcon(): string | undefined {
  let dir = app.getAppPath();
  for (let i = 0; i < 4; i++) {
    const file = join(dir, "buildResources", "icon.png");
    if (existsSync(file)) return file;
    dir = dirname(dir);
  }
  return undefined;
}
