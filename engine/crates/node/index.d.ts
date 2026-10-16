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
export function renderFrame(timeUs: number, width: number, height: number): Promise<FrameHandle>
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
