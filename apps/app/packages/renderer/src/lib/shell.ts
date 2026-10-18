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
  /**
   * The app's windows over either screen (components/dialogs/AppDialogs.tsx): Settings (the
   * home screen's gear, the top bar's gear and Menu, the menu bar), Shortcuts (the top bar's
   * keyboard, Help ▸ Shortcuts), About and the open-source notices.
   */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  noticesOpen: boolean;
  setNoticesOpen: (open: boolean) => void;
  /** The project's own settings (the inspector's Modify): its frame rate. */
  projectSettingsOpen: boolean;
  setProjectSettingsOpen: (open: boolean) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  view: "home",
  setView: (view) => set({ view }),
  homeSection: "home",
  setHomeSection: (homeSection) => set({ homeSection }),
  importOnOpen: false,
  setImportOnOpen: (importOnOpen) => set({ importOnOpen }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  noticesOpen: false,
  setNoticesOpen: (noticesOpen) => set({ noticesOpen }),
  projectSettingsOpen: false,
  setProjectSettingsOpen: (projectSettingsOpen) => set({ projectSettingsOpen }),
}));

/** Whether one of the app's windows is open over the screen (the editor's keys wait). */
export const appWindowOpen = () => {
  const s = useShellStore.getState();
  return s.settingsOpen || s.shortcutsOpen || s.aboutOpen || s.noticesOpen || s.projectSettingsOpen;
};
