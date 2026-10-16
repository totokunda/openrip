import { AppModule } from "src/AppModule.js";
import { ModuleContext } from "src/ModuleContext.js";
import Store from "electron-store";
import { ipcMain } from "electron";
import { EventEmitter } from "node:events";

interface Settings {
  activeProjectId?: string | number | null;
  /** Draw the preview with the Rust engine instead of the app's own renderer. */
  useEnginePreview?: boolean;
}

// Singleton instance
let settingsInstance: SettingsModule | null = null;

export class SettingsModule extends EventEmitter implements AppModule {
  private store: Store<Settings>;

  constructor() {
    super();
    this.store = new Store<Settings>();
    if (!settingsInstance) {
      settingsInstance = this;
    }
    return settingsInstance;
  }

  enable(_context: ModuleContext): void {
    this.registerHandlers();
  }

  getActiveProjectId(): string | null {
    const v = (this.store.get("activeProjectId") as string | number | null | undefined) ?? null;
    return typeof v === "string" ? v : v ? String(v) : null;
  }

  setActiveProjectId(projectId: string | number | null): void {
    this.store.set("activeProjectId", projectId ?? null);
    this.emit("active-project-id-changed", projectId ?? null);
  }

  private registerHandlers() {
    ipcMain.handle(
      "settings:get-active-project-id",
      (): string | number | undefined | null => {
        return this.store.get("activeProjectId") ?? null;
      },
    );

    ipcMain.handle(
      "settings:set-active-project-id",
      (_event, projectId: string | number | null): void => {
        this.setActiveProjectId(projectId);
      },
    );

    ipcMain.handle("settings:get-engine-preview", (): boolean => {
      return this.store.get("useEnginePreview") === true;
    });

    ipcMain.handle("settings:set-engine-preview", (_event, on: boolean): void => {
      this.store.set("useEnginePreview", on === true);
    });
  }
}

export function settingsModule(
  ...args: ConstructorParameters<typeof SettingsModule>
) {
  if (!settingsInstance) {
    settingsInstance = new SettingsModule(...args);
  }
  return settingsInstance;
}

export function getSettingsModule() {
  if (!settingsInstance) {
    settingsInstance = new SettingsModule();
  }
  return settingsInstance;
}
