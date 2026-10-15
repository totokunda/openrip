import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { ipcMain, shell } from "electron";

type IpcResponse<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Small, app-wide IPC handlers the editor needs (userData path, reveal in folder).
 */
export class CoreIpc implements AppModule {
  enable({ app }: ModuleContext): void {
    try {
      ipcMain.removeHandler("config:get-user-data-path");
      ipcMain.removeHandler("files:reveal-in-folder");
    } catch {}

    ipcMain.handle(
      "config:get-user-data-path",
      async (): Promise<IpcResponse<{ user_data: string }>> => {
        try {
          return { success: true, data: { user_data: app.getPath("userData") } };
        } catch (e: any) {
          return {
            success: false,
            error: e?.message || "Failed to resolve userData path",
          };
        }
      },
    );

    ipcMain.handle(
      "files:reveal-in-folder",
      async (_event, absPath: string): Promise<IpcResponse<{ path: string }>> => {
        try {
          if (typeof absPath !== "string" || !absPath) {
            return { success: false, error: "Invalid path" };
          }
          shell.showItemInFolder(absPath);
          return { success: true, data: { path: absPath } };
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to reveal item in folder",
          };
        }
      },
    );
  }
}

export function coreIpc() {
  return new CoreIpc();
}
