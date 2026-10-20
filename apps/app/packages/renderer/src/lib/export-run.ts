// Running an export from the dialog's choices: each part that's switched on (the video with its
// sound, the sound alone, a GIF, the captions) is a file written one after the other, the video,
// sound and GIF by the engine and the captions from the timeline's texts. The state of the run
// (which file, how far, what it wrote, what went wrong) is a store the dialog and the top bar
// show; progress is the whole run's.
import { create } from "zustand";
import { revealPathInFolder, resolvePath, writeFileBuffer } from "@app/preload";
import { toast } from "sonner";
import { useViewportStore } from "./viewport";
import { useControlsStore } from "./control";
import { cancelEngineExport, engineExportProject } from "./engine-preview";
import { timelineCues } from "./caption-actions";
import { writeSrt } from "./captions";
import { exportFinished } from "./export-finished";
import { AUDIO_EXTENSION, GIF_FPS, outputSize, videoBitrate, type AudioFormat, type CaptionFormat, type VideoSettings } from "./export-options";

/** What the dialog asks for: each part is `null` when its checkbox is off. */
export type ExportSettings = {
  name: string;
  /** The folder the files go in. */
  path: string;
  video: VideoSettings | null;
  /** Whether the video carries the project's sound. */
  videoAudio: boolean;
  audio: AudioFormat | null;
  /** The GIF's shorter side in pixels. */
  gif: number | null;
  captions: CaptionFormat | null;
};

export type ExportFile = { label: string; path: string; note?: string };

export type ExportRunState = {
  phase: "idle" | "running" | "done" | "failed" | "cancelled";
  /** The part being written ("Video", "Audio", "GIF", "Captions"). */
  label: string;
  /** 0..1 over the whole run. */
  ratio: number;
  /** When the run began (ms), for the time left. */
  startedAt: number;
  cancelling: boolean;
  files: ExportFile[];
  error: string | null;
  reset: () => void;
};

export const useExportRun = create<ExportRunState>((set) => ({
  phase: "idle",
  label: "",
  ratio: 0,
  startedAt: 0,
  cancelling: false,
  files: [],
  error: null,
  reset: () => set({ phase: "idle", label: "", ratio: 0, cancelling: false, files: [], error: null }),
}));

const join = (dir: string, file: string) => `${dir.replace(/\/+$/, "")}/${file}`;

/** The files an export of `s` writes, in the order it writes them. */
export function exportTargets(s: ExportSettings): { kind: "video" | "audio" | "gif" | "captions"; label: string; file: string }[] {
  const base = s.name.trim();
  const out: { kind: "video" | "audio" | "gif" | "captions"; label: string; file: string }[] = [];
  if (s.video) out.push({ kind: "video", label: "Video", file: `${base}.${s.video.format}` });
  if (s.audio) out.push({ kind: "audio", label: "Audio", file: `${base}.${AUDIO_EXTENSION[s.audio]}` });
  if (s.gif) out.push({ kind: "gif", label: "GIF", file: `${base}.gif` });
  if (s.captions) out.push({ kind: "captions", label: "Captions", file: `${base}.${s.captions}` });
  return out;
}

/** The captions as a file's text: SRT, or just the words (TXT, a paragraph a caption). */
export function captionsText(format: CaptionFormat, timelineId?: string): string | null {
  const cues = timelineCues(timelineId);
  if (!cues.length) return null;
  return format === "srt" ? writeSrt(cues) : cues.map((c) => c.text).join("\n\n") + "\n";
}

/** Write the files `s` asks for. Resolves when the run ends; its outcome is in [`useExportRun`]. */
export async function runExport(s: ExportSettings, scope?: { clipIds: string[]; range?: { start: number; end: number } }, timelineId?: string): Promise<void> {
  const run = useExportRun;
  const targets = exportTargets(s);
  if (!targets.length || !s.name.trim() || !s.path.trim()) return;
  const dir = resolvePath(s.path.trim());
  const ratio = (() => {
    const a = useViewportStore.getState().aspectRatio;
    return a.width / a.height;
  })();
  run.setState({ phase: "running", label: targets[0].label, ratio: 0, startedAt: Date.now(), cancelling: false, files: [], error: null });
  const files: ExportFile[] = [];
  for (const [i, t] of targets.entries()) {
    if (run.getState().cancelling) break;
    const path = join(dir, t.file);
    const at = (r: number) => run.setState({ label: t.label, ratio: (i + Math.max(0, Math.min(1, r))) / targets.length });
    at(0);
    if (t.kind === "captions") {
      const text = captionsText(s.captions!, timelineId);
      if (text == null) {
        files.push({ label: t.label, path, note: "There are no captions on the timeline" });
      } else {
        try {
          await writeFileBuffer(path, new TextEncoder().encode(text));
          files.push({ label: t.label, path });
        } catch (e) {
          run.setState({ phase: "failed", error: `Captions: ${e instanceof Error ? e.message : String(e)}`, files });
          return;
        }
      }
      at(1);
      continue;
    }
    const base = { path, fps: useControlsStore.getState().fps || 30, codec: "h264", bitrate: 0, audio: false, width: 0, height: 0 };
    const request =
      t.kind === "video"
        ? (() => {
            const v = s.video!;
            const size = outputSize(v.resolution, ratio);
            return { ...base, ...size, fps: v.fps, codec: v.codec, bitrate: videoBitrate(v, size), exactBitrate: v.bitrate === "custom", audio: s.videoAudio };
          })()
        : t.kind === "audio"
          ? { ...base, kind: "audio" as const, audioFormat: s.audio! }
          : { ...base, kind: "gif" as const, shortSide: s.gif!, fps: GIF_FPS };
    const r = await engineExportProject(request, at, scope, timelineId);
    if (r.ok) {
      files.push({ label: t.label, path });
    } else if (r.cancelled) {
      break;
    } else {
      console.error("[engine] export failed:", r.error);
      run.setState({ phase: "failed", error: `${t.label}: ${r.error ?? "the export failed"}`, files });
      return;
    }
  }
  if (run.getState().cancelling) {
    run.setState({ phase: "cancelled", files, cancelling: false });
    return;
  }
  run.setState({ phase: "done", ratio: 1, files, cancelling: false });
  const first = files.find((f) => !f.note);
  if (first) {
    toast("Export completed", { description: files.length > 1 ? `${files.length} files in ${dir}` : first.path });
    exportFinished(first.path);
  }
}

/** Stop the running export; files already written stay. */
export function cancelExportRun() {
  if (useExportRun.getState().phase !== "running") return;
  useExportRun.setState({ cancelling: true });
  void cancelEngineExport();
}

/** Show a file in Finder. */
export function revealExported(path: string) {
  void revealPathInFolder(path);
}
