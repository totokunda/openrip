// Project settings > Imported media: "Copy media to project" or "Stay in original location".
// With copying on, a file imported into the project is copied into the project's media folder
// (not linked to where it is), so the project keeps working when the original moves. Turning it
// on also copies what is already imported. The choice is kept per project in the user data
// folder (lib/user-store.ts).
import { create } from "zustand";
import { copyMediaIntoProject } from "@app/preload";
import { loadStored, saveStored } from "../user-store";
import { bumpMediaLibraryVersion } from "./library";

const STORE_KEY = "copy-media";

const parse = (v: unknown): Record<string, boolean> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "boolean")) as Record<string, boolean> : undefined;

export const useCopyMedia = create<{ byProject: Record<string, boolean> }>(() => ({ byProject: {} }));

void loadStored(STORE_KEY, null, parse).then((v) => v && useCopyMedia.setState((s) => ({ byProject: { ...v, ...s.byProject } })));

/** Whether imports into the project (its media folder id) are copied. */
export const copyMediaFor = (folderUuid: string | undefined | null): boolean => !!useCopyMedia.getState().byProject[folderUuid ?? "_"];

/** Choose for the project; turning copying on copies what is imported already. Resolves with how many files were copied. */
export const setCopyMedia = async (folderUuid: string | undefined | null, on: boolean): Promise<number> => {
  const key = folderUuid ?? "_";
  const byProject = { ...useCopyMedia.getState().byProject, [key]: on };
  useCopyMedia.setState({ byProject });
  saveStored(STORE_KEY, byProject);
  if (!on) return 0;
  const n = await copyMediaIntoProject(folderUuid ?? undefined);
  if (n > 0) bumpMediaLibraryVersion();
  return n;
};
