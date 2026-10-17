import { ipcRenderer } from "electron";

/** A CapCut draft on this Mac, as CapCut's home screen lists it. */
export type CapCutDraft = {
  name: string;
  folder: string;
  /** CapCut's render of the first frame, if it has one. */
  cover: string | null;
  durationUs: number;
  modifiedMs: number;
};

export type CapCutImportResult =
  | {
      success: true;
      data: { id: number; name: string; fps: number; folderUuid: string; aspectRatio?: { width: number; height: number; id: string }; coverPath?: string };
      /** Media the draft uses that isn't on this Mac. */
      missingMedia: string[];
      /** What the engine keeps from the draft but doesn't draw yet. */
      notes: string[];
    }
  | { success: false; error: string };

/** CapCut's drafts, newest first; empty without CapCut. */
export function capcutListDrafts(): Promise<CapCutDraft[]> {
  return ipcRenderer.invoke("capcut:list-drafts");
}

/** Ask for a draft folder; null if cancelled. */
export function capcutPickDraft(): Promise<string | null> {
  return ipcRenderer.invoke("capcut:pick-draft");
}

/** Open the draft in `folder` as a new project (the draft itself is only read). */
export function capcutImport(folder: string): Promise<CapCutImportResult> {
  return ipcRenderer.invoke("capcut:import", folder);
}
