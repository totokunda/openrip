import { create } from "zustand";

/**
 * The inspector's tab ("video", "animation", …) and each tab's sub-tab ("basic", "mask"). Kept
 * here rather than in the panel so the tab stays put from one selected clip to the next, as
 * in CapCut, and so the left panel can open one (a transition picked there shows the
 * Animation tab). A tab the selected clip doesn't have falls back to its first.
 */
interface InspectorState {
  tab: string;
  sub: Record<string, string>;
  setTab: (tab: string, sub?: string) => void;
  setSub: (tab: string, sub: string) => void;
}

export const useInspectorStore = create<InspectorState>((set) => ({
  tab: "video",
  sub: {},
  setTab: (tab, sub) => set((s) => ({ tab, sub: sub ? { ...s.sub, [tab]: sub } : s.sub })),
  setSub: (tab, sub) => set((s) => ({ sub: { ...s.sub, [tab]: sub } })),
}));
