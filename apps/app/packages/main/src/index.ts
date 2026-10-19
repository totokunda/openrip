import type { AppInitConfig } from "./AppInitConfig.js";
import { createModuleRunner } from "./ModuleRunner.js";
import { disallowMultipleAppInstance } from "./modules/SingleInstanceApp.js";
import { createWindowManagerModule } from "./modules/WindowManager.js";
import { terminateAppOnLastWindowClose } from "./modules/ApplicationTerminatorOnLastWindowClose.js";
import { hardwareAccelerationMode } from "./modules/HardwareAccelerationModule.js";
import { autoUpdater } from "./modules/AutoUpdater.js";
import { allowInternalOrigins } from "./modules/BlockNotAllowdOrigins.js";
import { chromeDevToolsExtension } from "./modules/ChromeDevToolsExtension.js";
import { createNativeFileDialogModule } from "./modules/NativeFileDialog.js";
import { settingsModule } from "./modules/SettingsModule.js";
import { jsonPersistenceModule } from "./modules/JSONPersistenceModule.js";
import { appDirProtocol } from "./modules/AppDirProtocol.js";
import { coreIpc } from "./modules/CoreIpc.js";
import { engineModule } from "./modules/EngineModule.js";
import { voiceoverModule } from "./modules/VoiceoverModule.js";
import { applyFakeCapture, recordModule } from "./modules/RecordModule.js";
import { speechModule } from "./modules/SpeechModule.js";
import { capCutImportModule } from "./modules/CapCutImportModule.js";
import { appMenu } from "./modules/AppMenu.js";
import { stickerLibraryModule } from "./modules/StickerLibraryModule.js";
import { musicLibraryModule } from "./modules/MusicLibraryModule.js";
import { clipPresetsModule } from "./modules/ClipPresetsModule.js";
import { userStoreModule } from "./modules/UserStoreModule.js";
import { stockLibraryModule } from "./modules/StockLibraryModule.js";
import { app } from "electron";

export async function initApp(initConfig: AppInitConfig) {
  // Set app name early, before any modules are initialized
  app.setName("OpenRip");
  // Test mode: the fake camera and microphone are switches, which must be set before the app is ready.
  applyFakeCapture();

  let moduleRunner = createModuleRunner()
    // Ensure single instance lock before any window creation
    .init(disallowMultipleAppInstance())
    // Settings must be loaded early (before other modules read them)
    .init(settingsModule())
    // Register 'app://' protocol handlers and core IPC before any renderer windows load
    .init(coreIpc())
    // The Rust engine, before any window asks for it
    .init(engineModule())
    // Voiceover recording through the engine, once it's loaded
    .init(voiceoverModule())
    // Record: the screens that can be recorded, camera and microphone permissions
    .init(recordModule())
    // Auto captions: local speech recognition and its models
    .init(speechModule())
    .init(jsonPersistenceModule())
    .init(capCutImportModule())
    // The Stickers tab's downloads and cache
    .init(stickerLibraryModule())
    // The Audio tab's Music and Sound effects (Openverse) and their cache
    .init(musicLibraryModule())
    // Media > Yours > My presets: the saved clip presets
    .init(clipPresetsModule())
    // Favourites and recent searches of the libraries, kept in the user data folder
    .init(userStoreModule())
    // The Media tab's stock Library: searches of openly licensed sources and the downloads
    .init(stockLibraryModule())
    .init(appMenu())
    .init(appDirProtocol())
    .init(
      createWindowManagerModule({
        initConfig,
      }),
    )
    .init(terminateAppOnLastWindowClose())
    .init(hardwareAccelerationMode({ enable: true }))
    .init(autoUpdater())
    .init(chromeDevToolsExtension({ extension: "REACT_DEVELOPER_TOOLS" }))
    // Security
    .init(
      allowInternalOrigins(
        new Set(
          initConfig.renderer instanceof URL
            ? [initConfig.renderer.origin]
            : [],
        ),
      ),
    );
  // Native file dialog for renderer via preload
  moduleRunner = moduleRunner.init(createNativeFileDialogModule());

  await moduleRunner;
}
