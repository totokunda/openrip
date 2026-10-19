import { app, desktopCapturer, ipcMain, session, systemPreferences } from "electron";
import { AppModule } from "../AppModule.js";
import { ModuleContext } from "../ModuleContext.js";

/**
 * What the Media tab's Record (screen or camera) and the Voiceover panel need from the system:
 * the screens and windows that can be recorded, the permissions (macOS asks for the camera and
 * the microphone, and the screen needs Screen Recording turned on in System Settings), and the
 * screen the page's getDisplayMedia gets. The pictures and sound are captured in the page and
 * saved by the preload (lib/record.ts, preload/record.ts).
 *
 * With `OPENRIP_FAKE_MIC` or `OPENRIP_FAKE_CAPTURE` set (automated tests) nothing real is
 * captured or asked: Chromium's fake camera and the page's own test microphone (a steady
 * 440 Hz tone, a quarter of full scale) stand in for the devices, and the screen list is two
 * made-up entries the page draws itself. `OPENRIP_FAKE_MIC=denied` and `OPENRIP_FAKE_CAPTURE=denied` play refused
 * permissions instead.
 */

export type RecordSource = { id: string; name: string; kind: "screen" | "window"; thumbnail: string };

export type RecordSources = {
  /** The screen recording permission: "granted", "denied", "restricted", "not-determined" or "unknown". */
  permission: string;
  sources: RecordSource[];
};

const fakeMode = () => process.env.OPENRIP_FAKE_CAPTURE || process.env.OPENRIP_FAKE_MIC;
const fakeDenied = () => process.env.OPENRIP_FAKE_CAPTURE === "denied" || process.env.OPENRIP_FAKE_MIC === "denied";

/**
 * Before the app is ready: in test mode, Chromium's fake camera (a moving test picture) and
 * no permission prompt. The microphone is faked in the page instead (lib/mic.ts `FAKE_MICS`): a
 * tone from an oscillator, because Chromium's fake microphone needs the audio service, which
 * the sandboxes automated tests run in don't have.
 */
export function applyFakeCapture(): void {
  if (!fakeMode()) return;
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}

const permission = (kind: "camera" | "microphone" | "screen"): string => {
  if (fakeDenied()) return "denied";
  if (fakeMode()) return "granted";
  if (process.platform !== "darwin" && process.platform !== "win32") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus(kind);
  } catch {
    return "unknown";
  }
};

export class RecordModule implements AppModule {
  /** The screen or window the page's next getDisplayMedia gets. */
  #picked: string | null = null;

  enable(_context: ModuleContext): void {
    for (const channel of ["record:sources", "record:permission", "record:ask", "record:pick", "record:fake"]) {
      try {
        ipcMain.removeHandler(channel);
      } catch {}
    }

    // Test mode: the page records fake devices (a tone for the microphone).
    ipcMain.handle("record:fake", () => !!fakeMode());

    ipcMain.handle("record:permission", (_e, kind: "camera" | "microphone" | "screen") => permission(kind));

    // macOS asks for the camera and the microphone the first time; true if it may be used.
    ipcMain.handle("record:ask", async (_e, kind: "camera" | "microphone"): Promise<boolean> => {
      if (fakeDenied()) return false;
      if (fakeMode() || process.platform !== "darwin") return true;
      if (systemPreferences.getMediaAccessStatus(kind) === "granted") return true;
      return systemPreferences.askForMediaAccess(kind);
    });

    ipcMain.handle("record:sources", async (): Promise<RecordSources> => {
      if (fakeMode()) {
        return {
          permission: permission("screen"),
          sources: [
            { id: "fake:screen", name: "Screen 1", kind: "screen", thumbnail: "" },
            { id: "fake:window", name: "Test window", kind: "window", thumbnail: "" },
          ],
        };
      }
      const perm = permission("screen");
      try {
        const found = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
        return {
          permission: perm,
          sources: found
            .filter((s) => s.name !== "")
            .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith("screen:") ? "screen" : "window", thumbnail: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL() })),
        };
      } catch {
        // macOS refuses the list without Screen Recording permission on some versions.
        return { permission: perm === "granted" ? "unknown" : perm, sources: [] };
      }
    });

    ipcMain.handle("record:pick", (_e, id: string | null) => {
      this.#picked = id;
    });

    app.whenReady().then(() => {
      session.defaultSession.setDisplayMediaRequestHandler(
        async (_request, callback) => {
          try {
            const id = this.#picked;
            const found = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
            const source = found.find((s) => s.id === id) ?? found.find((s) => s.id.startsWith("screen:"));
            callback(source ? { video: source } : {});
          } catch {
            callback({});
          }
        },
        { useSystemPicker: false },
      );
    });
  }
}

export function recordModule(): RecordModule {
  return new RecordModule();
}
