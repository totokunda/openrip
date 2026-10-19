/**
 * The app's menu bar. The app menu is CapCut's: About, Settings, Back to home page, Layout ▸,
 * More ▸ (the open-source notices), Quit; Help ▸ Shortcuts opens the Shortcuts window. Those
 * send `menu:command` to the window, which opens its own windows (`components/dialogs/AppDialogs.tsx`).
 *
 * File ▸ New project, Import and Export and Edit ▸ Split are the same actions as their keys
 * (the page carries them out: `menu:command`); the keys are shown on the items but not
 * registered (`registerAccelerator: false`), since the page handles the key press itself.
 *
 * Edit ▸ Undo and Redo undo the editor's own edits (`lib/history.ts` in the renderer), not only
 * the text in a focused field: they send `menu:edit` to the window; the page undoes a focused
 * field's typing itself and anything else through its history. The keyboard shortcuts reach
 * the page first and are handled there, so a key press never runs both. Their accelerators
 * follow the Shortcuts window's bindings (`menu:set-state`), so a key the user moved away from
 * Undo doesn't still undo through the menu.
 */
import { BrowserWindow, Menu, ipcMain, type MenuItemConstructorOptions } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";
import { editorWindowFor } from "./PanelWindows.js";

type MenuState = {
  /** The window's screen: Back to home page only works from the editor. */
  view: "home" | "editor";
  /** Electron accelerators for Undo and Redo ("" for none). */
  undo: string;
  redo: string;
  /** The keys shown on File ▸ New project, Import, Export and Edit ▸ Split. */
  newProject: string;
  importMedia: string;
  export: string;
  split: string;
};

let state: MenuState = {
  view: "home",
  undo: "CmdOrCtrl+Z",
  redo: "Shift+CmdOrCtrl+Z",
  newProject: "CmdOrCtrl+N",
  importMedia: "CmdOrCtrl+I",
  export: "CmdOrCtrl+E",
  split: "CmdOrCtrl+B",
};

/** An item that shows its key without taking the press (the page handles it). */
const shown = (accelerator: string): Partial<MenuItemConstructorOptions> =>
  accelerator ? { accelerator, registerAccelerator: false } : {};

// A panel's own window sends it to the editor it belongs to (it has no page of its own).
const target = (win?: Electron.BaseWindow) =>
  editorWindowFor((win instanceof BrowserWindow ? win : null) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]);

const sendEdit = (cmd: "undo" | "redo") => (_item: unknown, win?: Electron.BaseWindow) => {
  target(win)?.webContents.send("menu:edit", cmd);
};

const command = (cmd: string) => (_item: unknown, win?: Electron.BaseWindow) => {
  target(win)?.webContents.send("menu:command", cmd);
};

function template(): MenuItemConstructorOptions[] {
  const mac = process.platform === "darwin";
  const editor = state.view === "editor";
  const layouts: MenuItemConstructorOptions[] = [
    { label: "Default", click: command("layout:default") },
    { label: "Media", click: command("layout:media") },
    { label: "Inspector", click: command("layout:properties") },
    { label: "Vertical", click: command("layout:vertical") },
    { label: "Reset current layout", click: command("layout:reset") },
  ];
  const appItems: MenuItemConstructorOptions[] = [
    { label: "About", click: command("about") },
    { label: "Settings", accelerator: "CmdOrCtrl+,", click: command("settings") },
    { label: "Back to home page", enabled: state.view === "editor", click: command("home") },
    { label: "Layout", submenu: layouts },
    { label: "More", submenu: [{ label: "Third-party Copyright", click: command("notices") }] },
  ];
  return [
    ...(mac ? [{ label: "OpenRip", submenu: [...appItems, { label: "Quit", role: "quit" }] } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        { label: "New project", ...shown(state.newProject), click: command("new-project") },
        { label: "Import", enabled: editor, ...shown(state.importMedia), click: command("import") },
        { label: "Export", enabled: editor, ...shown(state.export), click: command("export") },
        { type: "separator" },
        ...(mac ? [{ role: "close" } as MenuItemConstructorOptions] : [...appItems, { type: "separator" } as MenuItemConstructorOptions, { role: "quit" } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { id: "undo", label: "Undo", ...(state.undo ? { accelerator: state.undo } : {}), click: sendEdit("undo") },
        { id: "redo", label: "Redo", ...(state.redo ? { accelerator: state.redo } : {}), click: sendEdit("redo") },
        { label: "Split", enabled: editor, ...shown(state.split), click: command("split") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(mac ? [{ role: "pasteAndMatchStyle" } as MenuItemConstructorOptions] : []),
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Shortcuts", click: command("shortcuts") },
        { label: "Walkthrough", enabled: editor, click: command("walkthrough") },
      ],
    },
  ];
}

const build = () => Menu.setApplicationMenu(Menu.buildFromTemplate(template()));

export class AppMenu implements AppModule {
  async enable({ app }: ModuleContext): Promise<void> {
    ipcMain.on("menu:set-state", (_e, next: Partial<MenuState>) => {
      const merged = { ...state, ...(next ?? {}) };
      if (JSON.stringify(merged) === JSON.stringify(state)) return;
      state = merged;
      if (app.isReady()) build();
    });
    await app.whenReady();
    build();
  }
}

export function appMenu() {
  return new AppMenu();
}
