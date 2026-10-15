import { ipcRenderer } from "electron";
import type { ConfigResponse } from "./types.js";

async function getUserDataPath(): Promise<
  ConfigResponse<{ user_data: string }>
> {
  return await ipcRenderer.invoke("config:get-user-data-path");
}

export { getUserDataPath };
