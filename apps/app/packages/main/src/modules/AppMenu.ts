/**
 * The app's menu bar. The app menu is CapCut's: About, Settings, Back to home page, Layout ▸,
 * More ▸ (the open-source notices), Quit; Help ▸ Shortcuts opens the Shortcuts window. Those
 * send `menu:command` to the window, which opens its own windows (`components/dialogs/AppDialogs.tsx`).
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

type MenuState = {
  /** The window's screen: Back to home page only works from the editor. */
  view: "home" | "editor";
  /** Electron accelerators for Undo and Redo ("" for none). */
  undo: string;
  redo: string;
};

let state: MenuState = { view: "home", undo: "CmdOrCtrl+Z", redo: "Shift+CmdOrCtrl+Z" };

const target = (win?: Electron.BaseWindow) =>
  (win instanceof BrowserWindow ? win : null) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

const sendEdit = (cmd: "undo" | "redo") => (_item: unknown, win?: Electron.BaseWindow) => {
  target(win)?.webContents.send("menu:edit", cmd);
};

const command = (cmd: string) => (_item: unknown, win?: Electron.BaseWindow) => {
  target(win)?.webContents.send("menu:command", cmd);
};

function template(): MenuItemConstructorOptions[] {
  const mac = process.platform === "darwin";
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
    mac ? { role: "fileMenu" } : { label: "File", submenu: [...appItems, { type: "separator" }, { role: "quit" }] },
    {
      label: "Edit",
      submenu: [
        { id: "undo", label: "Undo", ...(state.undo ? { accelerator: state.undo } : {}), click: sendEdit("undo") },
        { id: "redo", label: "Redo", ...(state.redo ? { accelerator: state.redo } : {}), click: sendEdit("redo") },
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
    { role: "help", submenu: [{ label: "Shortcuts", click: command("shortcuts") }] },
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
