/**
 * The app's menu bar: Electron's default menus, except that Edit ▸ Undo and Redo undo the
 * editor's own edits (`lib/history.ts` in the renderer), not only the text in a focused field.
 * They send `menu:edit` to the window; the page undoes a focused field's typing itself and
 * anything else through its history. The keyboard shortcuts reach the page first and are
 * handled there, so a key press never runs both.
 */
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";

const sendEdit = (cmd: "undo" | "redo") => (_item: unknown, win?: Electron.BaseWindow) => {
  const target = (win instanceof BrowserWindow ? win : null) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send("menu:edit", cmd);
};

function template(): MenuItemConstructorOptions[] {
  const mac = process.platform === "darwin";
  return [
    ...(mac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    { role: "fileMenu" },
    {
      label: "Edit",
      submenu: [
        { id: "undo", label: "Undo", accelerator: "CmdOrCtrl+Z", click: sendEdit("undo") },
        { id: "redo", label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: sendEdit("redo") },
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
  ];
}

export class AppMenu implements AppModule {
  async enable({ app }: ModuleContext): Promise<void> {
    await app.whenReady();
    Menu.setApplicationMenu(Menu.buildFromTemplate(template()));
  }
}

export function appMenu() {
  return new AppMenu();
}
