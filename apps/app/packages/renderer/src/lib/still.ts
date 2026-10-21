// The player's Export still frames (header menu), as CapCut's: the frame at the playhead, at
// the project's resolution, saved where the save dialog says. The engine renders it (the same
// picture the preview shows) and writes it as a PNG.
import { toast } from "sonner";
import { engineExportStill, pickSavePath, revealPathInFolder, type EngineStillResult } from "@app/preload";
import { useControlsStore } from "./control";
import { useClipStore } from "./clip";
import { useEnginePreviewStore } from "./engine-preview";
import { shownFrame } from "./playback-end";
import { useProjectsStore } from "./projects";

/** "HH-MM-SS-FF" for a file name. */
function stamp(frame: number, fps: number) {
  const rate = Math.max(1, Math.round(fps || 1));
  const f = Math.max(0, Math.round(frame || 0));
  const s = Math.floor(f / rate);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}-${pad(Math.floor((s % 3600) / 60))}-${pad(s % 60)}-${pad(f % rate)}`;
}

/** Ask where, then save the frame at the playhead; null if cancelled. */
export async function exportStillFrame(): Promise<EngineStillResult | null> {
  const engine = useEnginePreviewStore.getState();
  if (!engine.info?.available || !engine.project) {
    toast.error("Export still frames needs the engine preview");
    return { ok: false, error: "engine not available" };
  }
  const { focusFrame, fps } = useControlsStore.getState();
  const name = (useProjectsStore.getState().getActiveProject()?.name || "Frame").replace(/[\\/:*?"<>|]+/g, " ").trim();
  const path = await pickSavePath({
    title: "Export still frames",
    defaultPath: `${name} ${stamp(focusFrame, fps)}.png`,
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (!path) return null;
  const file = /\.png$/i.test(path) ? path : `${path}.png`;
  // The picture the player shows: the last frame on the project's end.
  const r = await engineExportStill((shownFrame(focusFrame, useClipStore.getState().clipDuration) / Math.max(1, fps)) * 1e6, file);
  if (r.ok) {
    toast.success(`Still frame saved (${r.width}×${r.height})`, {
      action: { label: "Show", onClick: () => void revealPathInFolder(r.path) },
    });
  } else {
    toast.error(`Couldn't save the still frame: ${r.error}`);
  }
  return r;
}
