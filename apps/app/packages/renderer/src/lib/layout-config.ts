import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dockAllPanels } from "./panel-windows";

/**
 * The editor's layouts, as CapCut's: Default; Media (the left panel full height); the
 * inspector full height ("properties"); Vertical (the player full height, for 9:16 work).
 */
export type AppLayoutId = "default" | "media" | "properties" | "vertical";

/** Where each layout's panel groups keep their sizes (react-resizable-panels' autoSaveId). */
export const layoutStorageKey = (layout: AppLayoutId) => `openrip:layout:${layout}`;

interface LayoutConfigState {
  layout: AppLayoutId;
  setLayout: (layout: AppLayoutId) => void;
  /**
   * Bumped by "Reset current layout": the panels mount again at their default sizes, and any
   * in windows of their own come back into the editor.
   */
  resetCount: number;
  resetLayout: () => void;
}

export const useLayoutConfigStore = create<LayoutConfigState>()(
  persist(
    (set, get) => ({
      layout: "default",
      setLayout: (layout) => set({ layout }),
      resetCount: 0,
      resetLayout: () => {
        // The saved sizes of the current layout's groups go; the next mount uses the defaults.
        const prefix = `react-resizable-panels:${layoutStorageKey(get().layout)}`;
        try {
          for (const key of Object.keys(window.localStorage)) {
            if (key.startsWith(prefix)) window.localStorage.removeItem(key);
          }
        } catch {}
        dockAllPanels();
        set((s) => ({ resetCount: s.resetCount + 1 }));
      },
    }),
    { name: "openrip:layout-config", partialize: (s) => ({ layout: s.layout }) },
  ),
);
