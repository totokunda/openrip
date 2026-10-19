// When the open project was last saved to its file (the editor top bar's "Auto saved
// hh:mm:ss"). The autosave in lib/middlewares/json-persistence.ts notes each save here.
import { create } from "zustand";

export const useAutosaveStore = create<{ projectId: number | null; at: number | null }>(() => ({ projectId: null, at: null }));

/** Note that project `projectId` was just saved. */
export const noteSaved = (projectId: number | string) => useAutosaveStore.setState({ projectId: Number(projectId), at: Date.now() });

/** "14:05:09", as the top bar shows it. */
export const clockLabel = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
