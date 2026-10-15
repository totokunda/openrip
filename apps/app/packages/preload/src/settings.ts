import { ipcRenderer } from "electron";

function getActiveProjectId(): Promise<string | number | undefined | null> {
  return ipcRenderer.invoke("settings:get-active-project-id");
}

function setActiveProjectId(projectId: string | number | null): Promise<void> {
  return ipcRenderer.invoke("settings:set-active-project-id", projectId);
}

export { getActiveProjectId, setActiveProjectId };
