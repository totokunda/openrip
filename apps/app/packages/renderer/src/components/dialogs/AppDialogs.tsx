// The app's windows over either screen (home or editor): Settings, Shortcuts, About, the
// open-source notices and the project's settings, opened through the shell store
// (lib/shell.ts) from the home screen's gear, the top bar and the menu bar's commands, which
// this also carries out (Back to home page, the layouts, File ▸ New project, Import, Export,
// Edit ▸ Split, Help ▸ Walkthrough) and the first-run walkthrough.
import React, { useEffect } from "react";
import { onMenuCommand, setMenuState } from "@app/preload";
import { useShellStore } from "@/lib/shell";
import { useLayoutConfigStore, type AppLayoutId } from "@/lib/layout-config";
import { goHome } from "@/lib/project-actions";
import { runAction } from "@/lib/timeline-shortcuts";
import SettingsWindow from "./settings/SettingsWindow";
import ShortcutsWindow from "./ShortcutsWindow";
import AboutWindow from "./AboutWindow";
import NoticesWindow from "./NoticesWindow";
import ProjectSettingsModal from "./ProjectSettingsModal";
import CoverEditor from "./CoverEditor";
import Walkthrough from "./Walkthrough";

const LAYOUTS: AppLayoutId[] = ["default", "media", "properties", "vertical"];

export const AppDialogs: React.FC = () => {
  const s = useShellStore();

  // The menu bar's Back to home page works from the editor only.
  useEffect(() => {
    try {
      setMenuState({ view: s.view });
    } catch {
      // no menu bar
    }
  }, [s.view]);

  useEffect(
    () =>
      onMenuCommand((cmd) => {
        const shell = useShellStore.getState();
        if (cmd === "settings") shell.setSettingsOpen(true);
        else if (cmd === "shortcuts") shell.setShortcutsOpen(true);
        else if (cmd === "about") shell.setAboutOpen(true);
        else if (cmd === "notices") shell.setNoticesOpen(true);
        else if (cmd === "walkthrough") {
          if (shell.view === "editor") shell.setWalkthroughOpen(true);
        } else if (cmd === "new-project") runAction("newProject");
        else if (cmd === "import") {
          if (shell.view === "editor") runAction("importMedia");
        } else if (cmd === "export") {
          if (shell.view === "editor") runAction("export");
        } else if (cmd === "split") {
          if (shell.view === "editor") runAction("split");
        } else if (cmd === "home") {
          if (shell.view === "editor") void goHome();
        } else if (cmd === "layout:reset") useLayoutConfigStore.getState().resetLayout();
        else if (cmd.startsWith("layout:")) {
          const id = cmd.slice(7) as AppLayoutId;
          if (LAYOUTS.includes(id)) useLayoutConfigStore.getState().setLayout(id);
        }
      }),
    [],
  );

  return (
    <>
      <SettingsWindow open={s.settingsOpen} onOpenChange={s.setSettingsOpen} />
      <ShortcutsWindow open={s.shortcutsOpen} onOpenChange={s.setShortcutsOpen} />
      <AboutWindow open={s.aboutOpen} onOpenChange={s.setAboutOpen} />
      <NoticesWindow open={s.noticesOpen} onOpenChange={s.setNoticesOpen} />
      {s.view === "editor" && <CoverEditor />}
      <Walkthrough />
      {s.view === "editor" && <ProjectSettingsModal open={s.projectSettingsOpen} onOpenChange={s.setProjectSettingsOpen} />}
    </>
  );
};

export default AppDialogs;
