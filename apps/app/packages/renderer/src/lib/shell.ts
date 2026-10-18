import { create } from "zustand";

/**
 * The window's screen: home (the projects) or the editor. Not saved: the app opens on home,
 * as CapCut does, with the last project already loaded behind it.
 */
export type ShellView = "home" | "editor";

/** The home screen's sections, from its sidebar. */
export type HomeSection = "home" | "templates" | "library";

interface ShellState {
  view: ShellView;
  setView: (view: ShellView) => void;
  homeSection: HomeSection;
  setHomeSection: (section: HomeSection) => void;
  /** Open the media picker once the editor shows (the home screen's Import media). */
  importOnOpen: boolean;
  setImportOnOpen: (on: boolean) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  view: "home",
  setView: (view) => set({ view }),
  homeSection: "home",
  setHomeSection: (homeSection) => set({ homeSection }),
  importOnOpen: false,
  setImportOnOpen: (importOnOpen) => set({ importOnOpen }),
}));
