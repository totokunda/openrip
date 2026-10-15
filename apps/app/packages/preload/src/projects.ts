import { ipcRenderer } from "electron";
import type { ConfigResponse } from "./types.js";

// Projects API functions
async function listProjects<T = any>(): Promise<ConfigResponse<T[]>> {
  return await ipcRenderer.invoke("projects:list-json");
}

async function createProject<T = any>(payload: {
  name: string;
  fps: number;
}): Promise<ConfigResponse<T>> {
  return await ipcRenderer.invoke("projects:create-json", payload);
}

async function deleteProject(
  projectId: string | number,
): Promise<ConfigResponse<{ id: string | number }>> {
  return await ipcRenderer.invoke("projects:delete-json", projectId);
}

async function saveProjectJson(
  projectId: string | number,
  data: any,
): Promise<ConfigResponse<{ path: string }>> {
  return await ipcRenderer.invoke("projects:save-json", projectId, data);
}

async function loadProjectJson(
  projectId: string | number,
): Promise<ConfigResponse<any | null>> {
  return await ipcRenderer.invoke("projects:load-json", projectId);
}

async function saveProjectCover(
  projectId: string | number,
  buffer: Uint8Array,
): Promise<ConfigResponse<{ path: string }>> {
  return await ipcRenderer.invoke("projects:save-cover", projectId, buffer);
}

async function clearProjectCover(
  projectId: string | number,
): Promise<ConfigResponse<{ ok: true }>> {
  return await ipcRenderer.invoke("projects:clear-cover", projectId);
}

export {
  listProjects,
  createProject,
  deleteProject,
  saveProjectJson,
  loadProjectJson,
  saveProjectCover,
  clearProjectCover,
};
