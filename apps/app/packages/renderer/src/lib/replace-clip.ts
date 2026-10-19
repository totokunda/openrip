import { toast } from "sonner";
import { importMediaFile, pickMediaPaths, revealMediaFile } from "@app/preload";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { useProjectsStore } from "./projects";
import { bumpMediaLibraryVersion } from "./media/library";
import { getMediaInfo } from "./media/utils";
import { VIDEO_EXTS, IMAGE_EXTS, AUDIO_EXTS } from "./settings";
import type { AnyClipProps, AudioClipProps, ImageClipProps, VideoClipProps } from "./types";

/**
 * More clip actions ▸ Replace clip (CapCut's): the clip keeps its place on the timeline, its
 * length, transform, effects and keyframes, and shows another file of its kind from that
 * file's start. A file shorter than the clip shortens it to the file (and says so). One undo
 * step: the clip's patch is the only change to the document.
 */

const FILES = {
  video: { name: "Video Files", extensions: VIDEO_EXTS },
  image: { name: "Image Files", extensions: IMAGE_EXTS },
  audio: { name: "Audio Files", extensions: AUDIO_EXTS },
} as const;

/** Whether Replace clip applies: a video, photo or sound clip. */
export const canReplaceClip = (clip: AnyClipProps | undefined): clip is VideoClipProps | ImageClipProps | AudioClipProps =>
  !!clip && (clip.type === "video" || clip.type === "image" || clip.type === "audio") && !!(clip as VideoClipProps).assetId;

/**
 * Put `path` (an absolute file path) in the place of `clipId`'s media. Resolves false when the
 * file can't be used (the wrong kind, unreadable).
 */
export async function replaceClipMedia(clipId: string, path: string): Promise<boolean> {
  const store = useClipStore.getState();
  const clip = store.getClipById(clipId) as AnyClipProps | undefined;
  if (!canReplaceClip(clip)) return false;
  const folder = useProjectsStore.getState().getActiveProject()?.folderUuid;
  const linked = await importMediaFile(path, folder);
  if (!linked) {
    toast.error("That file isn't a kind of media this app can use", { position: "bottom-right", duration: 5000 });
    return false;
  }
  bumpMediaLibraryVersion();
  const info = await getMediaInfo(linked.url).catch(() => null);
  const kind = info?.video ? "video" : info?.audio && !info?.image ? "audio" : info?.image ? "image" : null;
  if (!info || kind !== clip.type) {
    toast.error(`Pick ${clip.type === "audio" ? "an audio file" : clip.type === "video" ? "a video" : "a photo"} to replace this ${clip.type === "audio" ? "sound" : clip.type} clip`, { position: "bottom-right", duration: 5000 });
    return false;
  }

  const fps = useControlsStore.getState().fps || 30;
  const width = info.video?.displayWidth ?? info.image?.width;
  const height = info.video?.displayHeight ?? info.image?.height;
  const asset = useClipStore.getState().addAsset({ path: linked.url, type: kind, duration: info.duration ?? 0, width, height });

  const patch: Record<string, unknown> = {
    assetId: asset.id,
    assetIdHistory: [...(((clip as VideoClipProps).assetIdHistory ?? []) as string[]), (clip as VideoClipProps).assetId],
  };
  if (width && height) {
    patch.mediaWidth = width;
    patch.mediaHeight = height;
    patch.mediaAspectRatio = width / height;
  }
  if (clip.type !== "image") {
    // From the new file's start, as long as the clip was, or as long as the file if shorter.
    const speed = Math.max(0.1, Number((clip as VideoClipProps).speed) || 1);
    const length = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
    const available = Math.max(1, Math.floor(((info.duration ?? 0) * fps) / speed));
    patch.trimStart = 0;
    if (available < length) {
      patch.endFrame = (clip.startFrame ?? 0) + available;
      patch.trimEnd = 0;
      toast.warning(`${path.split(/[/\\]/g).pop()} is shorter than the clip, so the clip is now as long as the file`, { position: "bottom-right", duration: 6000 });
    } else {
      patch.trimEnd = -(available - length);
    }
  }
  store.updateClip(clipId, patch as Partial<AnyClipProps>);
  return true;
}

/** Pick a file (the native dialog) and replace the clip's media with it. */
export async function replaceClip(clipId: string): Promise<void> {
  const clip = useClipStore.getState().getClipById(clipId) as AnyClipProps | undefined;
  if (!canReplaceClip(clip)) return;
  const picked = (await pickMediaPaths({ title: "Replace clip", filters: [{ ...FILES[clip.type] }] }))[0];
  if (picked) await replaceClipMedia(clipId, picked);
}

/** Open file location: show the clip's file in the Finder. */
export async function revealClipFile(clipId: string): Promise<void> {
  const store = useClipStore.getState();
  const clip = store.getClipById(clipId) as { assetId?: string } | undefined;
  const asset = clip?.assetId ? store.getAssetById(clip.assetId) : undefined;
  if (asset) await revealMediaFile(asset.path);
}
