// Types for the openrip-node addon (engine/crates/node/src/lib.rs). Times are microseconds
// on the timeline unless the name says otherwise. One project is open at a time.

export interface ProjectInfo {
  name: string
  width: number
  height: number
  fps: number
  durationUs: number
  tracks: number
  segments: number
  /** Where the project came from: "capcut", "openrip" or "v1". */
  source: string
  /**
   * After updateProject: where CapCut texts whose words or style the edit changed are now
   * laid out, so the app's box around each can follow. Empty otherwise.
   */
  textBlocks: TextBlock[]
}

/** A text segment's block of lines on the canvas, in canvas pixels, before its rotation. */
export interface TextBlock {
  segment: string
  left: number
  top: number
  width: number
  height: number
}

/** The addon's version, so the app can tell which engine it loaded. */
export function version(): string

/** Open a CapCut draft folder, an OpenRip project JSON or a v1 project file (replaces any open one). */
export function openProject(path: string): ProjectInfo
/** Open from JSON text: an OpenRip project, a v1 project or a CapCut draft's draft_info.json. */
export function openProjectJson(json: string): ProjectInfo
/** Swap in an edited project (same formats) without reopening anything: decoders stay warm, playback continues. */
export function updateProject(json: string): ProjectInfo
export function close(): void

export interface FrameHandle {
  id: number
  /** IOSurfaceRef pointer bytes for Electron's sharedTexture (BGRA). */
  ioSurface: Buffer
  width: number
  height: number
  timeUs: number
  renderMs: number
  /** Layers drawn, and layers skipped because their media or font is missing. */
  layers: number
  skipped: number
}

/** Render one frame on a worker thread. Call release(id) when Electron is done with it. */
export function renderFrame(timeUs: number, width: number, height: number, scrub?: boolean): Promise<FrameHandle>
export function release(id: number): void

export interface Image {
  width: number
  height: number
  /** Straight-alpha RGBA, width * height * 4 bytes. */
  data: Buffer
}

/** Render one frame and read it back (tests, stills). */
export function renderImage(timeUs: number, width: number, height: number): Image

/** Start audio (and the master clock) at timeUs; false without an output device. */
export function play(timeUs: number): boolean
export function pause(): void
/** The timeline time being heard now (pick video frames by it), or -1 without audio output. */
export function positionUs(): number
/** Output gain; 0 mutes (the clock keeps running). */
export function setVolume(volume: number): void

// Render-ahead preview (macOS): what the app's preview surface uses.

/** Size of the preview surfaces; creates the pipeline on the first call. */
export function setPreviewSize(width: number, height: number): void
/** Play from fromUs: sound starts and frames render ahead of the audio clock. */
export function startPlayback(fromUs: number): void
/** Stop; the picture stays on the frame at the returned stop time. */
export function stopPlayback(): number
/** Show the frame at timeUs (paused, scrubbing); the newest request wins. */
export function seek(timeUs: number): void

export interface DisplayFrame {
  id: number
  /** IOSurfaceRef pointer bytes for sharedTexture (BGRA). */
  ioSurface: Buffer
  width: number
  height: number
  timeUs: number
  renderMs: number
}

/** The frame to show now (newest due by the clock, or the last seek), or null if nothing is new. release(id) it when done. */
export function frameForDisplay(): DisplayFrame | null

// Timeline thumbnails and waveforms.

/** Keep exact thumbnails and waveforms in dir across runs. */
export function setThumbnailCacheDir(dir: string): void

export interface Thumbnail {
  /** Index into the requested times. */
  index: number
  timeUs: number
  /** False for a stand-in (its GOP's keyframe); ask again with exact for the real frame. */
  exact: boolean
  width: number
  height: number
  /** RGBA, width * height * 4 bytes. */
  rgba: Buffer
}

/** Thumbnails height px tall of a video or still at source times: quick (one keyframe per GOP) or exact. */
export function thumbnails(path: string, timesUs: number[], height: number, exact: boolean): Promise<Thumbnail[]>

export interface Waveform {
  /** Buckets per second. */
  perSecond: number
  /** Per bucket, of the mono mix: the largest absolute sample, and the RMS (0..1). */
  peak: Float32Array
  rms: Float32Array
}

/** Peaks of a file's audio (perSecond must divide 48000; 100 = one per 10 ms); null if it has no audio. */
export function waveform(path: string, perSecond: number): Promise<Waveform | null>

export interface ExportOptions {
  width: number
  height: number
  fps: number
  /** "h264" or "hevc". */
  codec: string
  /** Bits per second. */
  bitrate: number
  audio: boolean
}

export interface ExportResult {
  frames: number
  seconds: number
  /** Layers skipped because their media or font was missing, summed over frames. */
  skippedLayers: number
}

/** Export a project (same JSON formats as openProjectJson) on a worker thread, independent of the preview. Rejects with "cancelled" after cancelExport(). */
export function exportProject(json: string, path: string, options: ExportOptions): Promise<ExportResult>
/** The running (or last) export's frames done and total. */
export function exportProgress(): { done: number; total: number }
/** Stop the running export; the unfinished file is removed. */
export function cancelExport(): void


// CapCut drafts as app projects.

export interface AppProjectFromDraft {
  /** The app's project document (JSON), without the app's own `meta`. */
  json: string
  /** The draft's name. */
  name: string
  /** Media the draft uses that isn't on this Mac. */
  missingMedia: string[]
  /** What the importer couldn't map, one line each. */
  notes: string[]
}

/** The CapCut draft in folder dir as an app project, on a worker thread: the app's own clips, each carrying its segment so the engine draws it as CapCut did. */
export function capcutToApp(dir: string): Promise<AppProjectFromDraft>

// The Audio tab: beats, loudness, voiceover.

export interface BeatGrid {
  /** Beats per minute. */
  bpm: number
  /** Each beat's time in the file's media, in seconds. */
  times: Float64Array
  /** 1 where the beat starts a bar (in fours), else 0. */
  downbeats: Uint8Array
}

/** The beats in a file's audio (all of it), on a worker thread, kept in the thumbnail cache folder; null if it has no audio. */
export function beats(path: string): Promise<BeatGrid | null>

export interface Loudness {
  /** EBU R128 integrated loudness, LUFS; null for silence. */
  integrated: number | null
  /** The largest sample, dBFS. */
  peak: number
}

/** The loudness of a file over durationUs from startUs of its media (all of it for null), as CapCut measures it for "Normalize loudness"; null if it has no audio. */
export function loudness(path: string, startUs: number, durationUs: number | null): Promise<Loudness | null>

/** Start recording a voiceover from the default microphone into a new WAV file (one at a time: a running one is stopped and kept). */
export function startRecording(path: string): { rate: number; channels: number }
/** The recording's level since the last call (peak and RMS, 0..1); null when not recording. */
export function recordingLevel(): { peak: number; rms: number } | null
/** Stop recording and finish the file; null when not recording. */
export function stopRecording(): { path: string; durationUs: number; rate: number; channels: number } | null
/** For automated tests: record from a stand-in microphone that hears a steady 440 Hz tone. */
export function useToneInput(): void

// Fonts for text.

/** A font face for text, as CSS describes it (@font-face). */
export interface FontFace {
  family: string
  /** CSS weight (400 regular, 700 bold). */
  weight: number
  italic: boolean
  /** The font file (TrueType, OpenType or WOFF2). */
  path: string
  /** Its CSS unicode-range, for a web font split into one file per script. */
  unicodeRange?: string
}

/** Draw the app's text in these faces from now on (the app's bundled web fonts), each read when text first uses it. */
export function registerFonts(faces: FontFace[]): void

/** A family text can be drawn in. */
export interface FontFamily {
  name: string
  /** The weights it has faces for, ascending. */
  weights: number[]
  italic: boolean
  /** Registered by the app (its bundled fonts) rather than installed on the system. */
  bundled: boolean
}

/** The families text can be drawn in: the app's registered ones, then the installed ones. The first call reads the system's font folders. */
export function fontFamilies(): FontFamily[]
