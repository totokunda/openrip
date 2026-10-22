// Barrel file that re-exports all preload helpers, split into feature modules.
// This keeps the external API identical while avoiding a single giant implementation file.

// Core crypto/versioning
export { sha256sum } from "./nodeCrypto.js";
export { versions } from "./versions.js";

// CapCut drafts as projects
export { capcutListDrafts, capcutPickDraft, capcutImport } from "./capcut.js";
export { onMenuEdit, onMenuCommand, setMenuState } from "./menu.js";
export { onPanelWindowClosed, movePanelWindow } from "./windows.js";
export type { CapCutDraft, CapCutImportResult } from "./capcut.js";

// The Rust engine in the main process
export {
  engineInfo,
  engineSyncProject,
  engineRender,
  engineClose,
  enginePlay,
  enginePause,
  onEngineClock,
  onEngineEnded,
  engineExport,
  engineExportCancel,
  engineExportCodecs,
  engineOpenh264Info,
  onEngineCodecDownload,
  engineRenderCacheInfo,
  enginePrerender,
  enginePrerenderCancel,
  onEnginePrerenderProgress,
  engineRenderedRanges,
  engineDeleteRenderCache,
  onEngineRenderCacheChanged,
  engineRenderCacheStats,
  engineSetRenderCacheEnabled,
  type EnginePrerenderResult,
  engineThumbnails,
  engineEffectCatalog,
  engineEffectPreviews,
  engineTilePreview,
  engineProjectPreviews,
  type EngineEffect,
  type EngineTileSpec,
  type EngineTilePreview,
  engineBeats,
  engineWaveform,
  engineLoudness,
  engineRegisterFonts,
  engineFontFamilies,
  engineOutputLevels,
  engineScrubAudio,
  engineScrubAudioStop,
  engineScrubAudioStats,
  engineExportStill,
  engineDetectScenes,
  engineColorStats,
  engineAnalyseMotion,
  engineAutoAdjust,
  engineMotionReady,
  engineAnalysisProgress,
  engineCancelAnalysis,
  onEngineExportProgress,
  getEnginePreviewEnabled,
  setEnginePreviewEnabled,
  ENGINE_FRAME_CANVAS_ID,
  ENGINE_FRAME_EVENT,
} from "./engine.js";
export type { EngineInfo, EngineProjectInfo, EngineRenderResult, EngineExportOptions, EngineExportResult, EngineOpenh264Info, EngineThumbnail, EngineBeats, EngineWaveform, EngineFontFace, EngineFontFamily, EngineStillResult, EngineSceneCut, EngineColorStats, EngineMatchOn, EngineAutoAdjust, EngineAnalysis, EngineLook } from "./engine.js";

// Motion tracking with the engine (the Tracking tab and Track mask)
export { engineTrack, engineTrackCancel, onEngineTrackProgress } from "./engine.js";
export type { EngineTrackRequest, EngineTrackResult, EngineTrackSample } from "./engine.js";

// Voiceover recording (the main process's VoiceoverModule)
export { voiceoverStatus, voiceoverStart, voiceoverStop, voiceoverCancel, voiceoverList, onVoiceoverLevel } from "./voiceover.js";
export type { VoiceoverStatus, VoiceoverStart, VoiceoverStop, VoiceoverLevel, VoiceoverTake } from "./voiceover.js";

// Record (screen, camera) and the Voiceover panel's own capture
export { recordFake, recordSources, recordPermission, recordAsk, recordPick, recordingSave, voiceoverSaveTake, voiceoverAsk, voiceoverBegin, voiceoverEnd } from "./record.js";
export type { RecordSource, RecordSources, RecordKind, SavedRecording, SavedTake } from "./record.js";

// The Stickers tab's downloads and cache
export { stickersCached, stickerDownload, stickerStore } from "./stickers.js";
export type { StickerFile } from "./stickers.js";
// Media > Yours > My presets (the main process's ClipPresetsModule)
export { clipPresetsRead, clipPresetsWrite } from "./presets.js";
// Favourites and recent searches, in the user data folder (the main process UserStoreModule)
export { userStoreRead, userStoreSet } from "./userstore.js";
// The Audio tab's Music and Sound effects libraries (Openverse)
export { musicSearch, musicState, musicDownload, musicFavorite } from "./music.js";
export type { MusicKind, MusicLicense, MusicTrack, MusicSearch, MusicSearchResult, MusicFile } from "./music.js";
// The Media tab's stock Library (the main process's StockLibraryModule)
export { stockSearch, stockCached, stockDownload, openCreditUrl } from "./stock.js";
export type { StockSearchRes, StockFile } from "./stock.js";
// Auto captions: local speech recognition and its models (the main process's SpeechModule)
export { speechStatus, speechDownload, speechDownloadCancel, speechDelete, speechTranscribe, speechProgress, speechCancel } from "./speech.js";
export type { SpeechModelState, SpeechStatus, SpeechAsk, SpeechCaption, SpeechResult, SpeechAnswer } from "./speech.js";

// App updates (Electron auto-updater)
export * from "./appUpdates.js";

// Media processing primitives
export { processMediaTo24 } from "./media/process.js";
export { getMediaRootAbsolute } from "./media/root.js";
export {
  AUDIO_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  getLowercaseExtension,
} from "./media/fileExts.js";

import { pathToFileURL as pathToFileURLNode, fileURLToPath as fileURLToPathNode } from "node:url";

export const pathToFileURL = (path: string) => {
  return pathToFileURLNode(path).href;
};

export const fileURLToPath = (url: string) => {
  return fileURLToPathNode(url);
};

// Filters
export { fetchFilters } from "./filters/fetch.js";

// Shared types
export type { ConfigResponse } from "./types.js";
export type { ConvertedMediaItem } from "./media/library.js";

// Core IPC & filesystem helpers
export * from "./core/ipc.js";

// Media library and previews
export * from "./media/library.js";
export * from "./media/previews.js";
// Missing media and Link to media, Replace clip's import, Open file location
export * from "./media/relink.js";
export * from "./media/moved.js";
// Explicit re-export to ensure the virtual browser shim includes this new API.
export { exportVideoTranscodeWithFfmpeg } from "./media/previews.js";

// App paths (userData)
export * from "./config.js";

// Project JSON persistence
export * from "./projects.js";

// Settings helpers
export * from "./settings.js";

// Export result caching (persistent, electron-store)
export * from "./exportCache.js";
