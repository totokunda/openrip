import { ipcRenderer } from "electron";
import type { ConfigResponse } from "./types.js";

// Projects API functions
async function listProjects<T = any>(): Promise<ConfigResponse<T[]>> {
  return await ipcRenderer.invoke("projects:list-json");
}

async function createProject<T = any>(payload: {
  name: string;
  fps: number;
  /** The canvas; 16:9 when not given. */
  aspectRatio?: { width: number; height: number; id: string };
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

/** A deleted project in the Trash. */
export type TrashEntry = {
  id: number;
  name: string;
  fps?: number;
  aspectRatio?: { width: number; height: number; id: string };
  deletedAt: number;
  sizeBytes: number;
  durationUs: number;
  coverPath?: string;
  daysLeft: number;
};
async function listTrash(): Promise<ConfigResponse<TrashEntry[]>> {
  return await ipcRenderer.invoke("trash:list");
}
async function restoreFromTrash(ids: number[]): Promise<ConfigResponse<{ ids: number[] }>> {
  return await ipcRenderer.invoke("trash:restore", ids);
}
async function deleteFromTrash(ids: number[]): Promise<ConfigResponse<{ ids: number[] }>> {
  return await ipcRenderer.invoke("trash:delete", ids);
}
async function emptyTrash(): Promise<ConfigResponse<{ count: number }>> {
  return await ipcRenderer.invoke("trash:empty");
}

/** A project saved to start new ones from. */
export type TemplateEntry = {
  id: string;
  name: string;
  savedAt: number;
  aspectRatio?: { width: number; height: number; id: string };
  fps?: number;
  clipCount: number;
  durationUs: number;
  coverPath?: string;
  sizeBytes: number;
};
async function listTemplates(): Promise<ConfigResponse<TemplateEntry[]>> {
  return await ipcRenderer.invoke("templates:list");
}
async function saveProjectAsTemplate(projectId: number | string, name: string): Promise<ConfigResponse<TemplateEntry>> {
  return await ipcRenderer.invoke("templates:save", projectId, name);
}
async function renameTemplate(id: string, name: string): Promise<ConfigResponse<{ id: string }>> {
  return await ipcRenderer.invoke("templates:rename", id, name);
}
async function deleteTemplate(id: string): Promise<ConfigResponse<{ id: string }>> {
  return await ipcRenderer.invoke("templates:delete", id);
}
async function createProjectFromTemplate<T = any>(id: string, name: string): Promise<ConfigResponse<T>> {
  return await ipcRenderer.invoke("templates:use", id, name);
}

/** A media file the projects import (the Library page). */
export type LibraryItem = {
  path: string;
  name: string;
  type: "video" | "image" | "audio";
  sizeBytes: number;
  modifiedMs: number;
  createdMs: number;
  durationSec?: number;
  width?: number;
  height?: number;
  projects: string[];
};
async function listLibraryMedia(): Promise<ConfigResponse<LibraryItem[]>> {
  return await ipcRenderer.invoke("library:list");
}

export {
  listTrash,
  restoreFromTrash,
  deleteFromTrash,
  emptyTrash,
  listTemplates,
  saveProjectAsTemplate,
  renameTemplate,
  deleteTemplate,
  createProjectFromTemplate,
  listLibraryMedia,
  listProjects,
  createProject,
  deleteProject,
  saveProjectJson,
  loadProjectJson,
  saveProjectCover,
  clearProjectCover,
};
