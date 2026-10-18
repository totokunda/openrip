import { create } from "zustand";

/**
 * The window's screen: home (the projects) or the editor. Not saved: the app opens on home,
 * as CapCut does, with the last project already loaded behind it.
 */
export type ShellView = "home" | "editor";

interface ShellState {
  view: ShellView;
  setView: (view: ShellView) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  view: "home",
  setView: (view) => set({ view }),
}));
