import { ipcRenderer } from "electron";

/** Whether the Rust engine loaded in the main process, and which version. */
export type EngineInfo = {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
};

export function engineInfo(): Promise<EngineInfo> {
  return ipcRenderer.invoke("engine:info");
}
