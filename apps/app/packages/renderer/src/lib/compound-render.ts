// Pre-processing a compound clip (CapCut's way to give it a file): its timeline rendered by the
// engine, picture and mixed sound, into an MP4 in the app's data folder, which the compound then
// stands in with for the tools that read a media file (lib/compound-media.ts). Made on first use
// (a clean-up part or an audio tool switched on), with progress and Cancel, kept per content and
// made again when the content has changed while a tool still needs it. Playing the compound, the
// engine reads this file as a video (engine/crates/v1 `renderedAsset`), so the clean-up and the
// loudness tools work on it as on any clip.
import { create } from "zustand";
import { toast } from "sonner";
import { deleteFile, engineExport, engineExportCancel, getUserDataPath, mediaMissing, onEngineExportProgress } from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { useViewportStore } from "./viewport";
import { withoutHistory } from "./history";
import { compoundDocument } from "./middlewares/json-persistence";
import { withOriginalMedia } from "./engine-preview";
import { outputSize } from "./export-options";
import { contentLength } from "./compound";
import { loudnessOff, setReduceNoise } from "./audio.ts";
import { contentHash, findCompound, needsRender, patchCompound, renderedValid } from "./compound-media";
import type { AnyClipProps } from "./types";

/** The render being made, if one is. */
export const useCompoundRender = create<{ running: { clipId: string; ratio: number } | null }>(() => ({ running: null }));

const jobs = new Map<string, Promise<boolean>>();
/** Content keys whose render was cancelled or failed: not tried again until the content changes or a tool is switched on afresh. */
const declined = new Set<string>();
const files: string[] = [];
const KEEP = 8;
const TOAST = "compound-render";
let cancelling = false;

const urlOf = (path: string) => encodeURI(`file://${path}`).replace(/#/g, "%23").replace(/\?/g, "%3F");

/** Stop the render under way (its tools go back off where they need it). */
export const cancelCompoundRender = () => {
  cancelling = true;
  void engineExportCancel();
};

/** Forget a declined render (a tool was switched on again). */
export const retryCompoundRender = (clipId: string) => {
  const clip = findCompound(clipId);
  if (clip?.compound) declined.delete(contentHash(clip.compound));
};

/**
 * The compound clip's rendered file, made if it isn't there or is stale: resolves true when the
 * clip has a current one. The render runs once at a time; asking again while it runs waits for it.
 */
export function ensureCompoundRendered(clipId: string): Promise<boolean> {
  const clip = findCompound(clipId);
  if (!clip?.compound) return Promise.resolve(true);
  if (renderedValid(clip)) return Promise.resolve(true);
  const key = contentHash(clip.compound);
  const running = jobs.get(clipId);
  if (running) return running;
  let job!: Promise<boolean>;
  job = (async () => {
    const dir = (await getUserDataPath())?.data?.user_data;
    const ratioNow = useViewportStore.getState().aspectRatio;
    if (!dir) return false;
    const fps = useControlsStore.getState().fps || 30;
    const size = outputSize(1080, ratioNow.width / ratioNow.height);
    const path = `${dir}/compound-render-${key}.mp4`;
    cancelling = false;
    useCompoundRender.setState({ running: { clipId, ratio: 0 } });
    const show = (ratio: number) => toast.loading(`Pre-processing compound clip… ${Math.round(ratio * 100)}%`, { id: TOAST, duration: Infinity, action: { label: "Cancel", onClick: cancelCompoundRender } });
    show(0);
    const off = onEngineExportProgress((done, total) => {
      const ratio = total > 0 ? Math.min(1, done / total) : 0;
      useCompoundRender.setState({ running: { clipId, ratio } });
      show(ratio);
    });
    try {
      const snapshot = await withOriginalMedia(compoundDocument(clip.compound!));
      const r = await engineExport(0, snapshot, path, { width: size.width, height: size.height, fps, codec: "h264", bitrate: Math.round(size.width * size.height * fps * 0.2), audio: true });
      if (!r.ok) {
        console.warn("[compound-render] the export failed", JSON.stringify(r));
        declined.add(key);
        if (!cancelling && !("cancelled" in r && r.cancelled)) toast.error(`Couldn't pre-process the compound clip: ${"error" in r ? r.error : "the export failed"}`);
        return false;
      }
      const store = useClipStore.getState();
      const seconds = contentLength(clip.compound!) / fps;
      const asset = store.addAsset({ path: urlOf(path), type: "video", duration: seconds, width: size.width, height: size.height });
      const now = findCompound(clipId);
      if (!now?.compound) return false;
      // Edited while it rendered: that file is for the old content, so it's made again.
      if (contentHash(now.compound) !== key) {
        jobs.delete(clipId);
        return ensureCompoundRendered(clipId);
      }
      // Not a step of its own: the file is a cache of the content.
      withoutHistory(() => patchCompound(clipId, { renderedAssetId: asset.id, renderedKey: key }));
      files.push(path);
      while (files.length > KEEP) void deleteFile(files.shift()!).catch(() => undefined);
      return true;
    } catch (e) {
      console.warn("[compound-render] failed", e);
      declined.add(key);
      toast.error(`Couldn't pre-process the compound clip: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      off();
      toast.dismiss(TOAST);
      useCompoundRender.setState({ running: null });
      if (jobs.get(clipId) === job) jobs.delete(clipId);
    }
  })();
  jobs.set(clipId, job);
  return job;
}

/** For a tool that reads a clip's media: a compound is rendered first (resolves false if that didn't work); any other clip is ready. */
export const prepareMedia = async (clipId: string): Promise<boolean> => {
  const clip = useClipStore.getState().getClipById(clipId);
  if (!clip || !(clip as { compound?: unknown }).compound) return true;
  retryCompoundRender(clipId);
  return ensureCompoundRendered(clipId);
};

/** A compound whose rendered file is gone (cleaned up, or the project came from another machine) is as if it had none: it's rendered again where a tool needs it. */
const verified = new Set<string>();
const forgetMissingFiles = async () => {
  const { clips, assets } = useClipStore.getState();
  const rendered = clips.filter((c) => (c as { renderedAssetId?: string }).renderedAssetId && !verified.has((c as { renderedAssetId: string }).renderedAssetId));
  if (rendered.length === 0) return;
  rendered.forEach((c) => verified.add((c as { renderedAssetId: string }).renderedAssetId));
  const paths = rendered.map((c) => assets[(c as { renderedAssetId: string }).renderedAssetId]?.path).filter((p): p is string => !!p);
  const gone = new Set(await mediaMissing(paths).catch(() => [] as string[]));
  for (const c of rendered) {
    const id = (c as { renderedAssetId: string }).renderedAssetId;
    if (!assets[id]?.path || gone.has(assets[id].path)) withoutHistory(() => patchCompound(c.clipId, { renderedAssetId: undefined, renderedKey: undefined }));
  }
};

/** The tools that need the compound's file go back off (it couldn't be made, or the render was cancelled). */
const toolsOff = (clipId: string) => {
  const clip = useClipStore.getState().getClipById(clipId);
  if (!clip || renderedValid(clip)) return;
  useClipStore.getState().updateClip(clipId, { enhance: null, ...loudnessOff(clip), ...setReduceNoise(clip, false) } as Partial<AnyClipProps>);
};

/**
 * Keep the compounds that need their file supplied with a current one: when a clean-up part or
 * an audio tool is on and the file is missing or stale, it's made (a moment after the edits stop).
 * Returns a function that stops it.
 */
export function startCompoundRenderWatcher(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    timer = null;
    if (useCompoundRender.getState().running) return;
    for (const clip of useClipStore.getState().clips) {
      if (!needsRender(clip) || renderedValid(clip) || jobs.has(clip.clipId)) continue;
      const compound = (clip as { compound?: Parameters<typeof contentHash>[0] }).compound;
      if (!compound || declined.has(contentHash(compound))) continue;
      const id = clip.clipId;
      void ensureCompoundRendered(id).then((ok) => {
        // Off only where it was refused or failed (a render overtaken by an edit is simply made again).
        const now = findCompound(id);
        if (!ok && now?.compound && declined.has(contentHash(now.compound))) toolsOff(id);
        check();
      });
      return;
    }
  };
  void forgetMissingFiles().then(() => check());
  const off = useClipStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void forgetMissingFiles().then(check), 700);
  });
  return () => {
    off();
    if (timer) clearTimeout(timer);
  };
}
