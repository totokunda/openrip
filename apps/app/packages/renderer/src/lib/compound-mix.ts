// A compound clip's sound as one file: everything in its timeline mixed by the engine (volumes,
// fades, speeds, effects, as an export would), from frame 0 of its content. The clip's waveform
// on the timeline, Transcript, Generate captions and Extract audio all read the compound's sound
// from it, the way they read a video's from its media file.
import { useEffect, useState } from "react";
import { engineExport, getUserDataPath, deleteFile } from "@app/preload";
import { allClips, contentLength } from "./compound";
import { compoundDocument } from "./middlewares/json-persistence";
import { contentKey } from "./compound-thumb";
import { useControlsStore } from "./control";
import { waveformOf } from "./waveform-source";
import type { WaveformBuckets } from "./waveform.ts";
import type { AnyClipProps, CompoundContent } from "./types";
import { withOriginalMedia } from "./engine-preview";
import { useClipStore } from "./clip";

export type CompoundMix = { path: string; seconds: number };

const mixes = new Map<string, Promise<CompoundMix | null>>();
/** The newest mix files, oldest first: the rest are deleted as they go out of use. */
const files: string[] = [];
const KEEP = 12;

/** Whether the content can have sound at all: a clip with sound (not a silenced video) in it, deep. */
export const hasSound = (content: CompoundContent): boolean => {
  const assets = useClipStore.getState().assets;
  return allClips(content.clips).some((c: AnyClipProps) => {
    if (c.hidden || (c as { deactivated?: boolean }).deactivated) return false;
    if (c.type === "audio") return true;
    if (c.type !== "video" || (c as { compound?: unknown }).compound) return false;
    const path = assets[(c as { assetId: string }).assetId]?.path ?? "";
    return !path.endsWith("#video");
  });
};

/** The compound's content mixed to a WAV in the app's data folder (made once per content, kept for a while); null when it has no sound or the engine can't. */
export const compoundMix = (content: CompoundContent): Promise<CompoundMix | null> => {
  if (!hasSound(content)) return Promise.resolve(null);
  const key = contentKey(content);
  let p = mixes.get(key);
  if (!p) {
    p = (async () => {
      const dir = (await getUserDataPath())?.data?.user_data;
      if (!dir) return null;
      const path = `${dir}/compound-mix-${key}.wav`;
      const fps = useControlsStore.getState().fps || 24;
      const snapshot = await withOriginalMedia(compoundDocument(content));
      const r = await engineExport(0, snapshot, path, { kind: "audio", audioFormat: "wav", width: 0, height: 0, fps, codec: "", bitrate: 0, audio: true });
      if (!r.ok) return null;
      files.push(path);
      while (files.length > KEEP) void deleteFile(files.shift()!).catch(() => undefined);
      return { path, seconds: contentLength(content) / fps };
    })().catch(() => null);
    mixes.set(key, p);
    // A failed mix is asked for again next time.
    void p.then((m) => !m && mixes.delete(key));
  }
  return p;
};

/**
 * A compound clip's waveform buckets: the mix's, once it's made (a moment after the content
 * stops changing). Null until then, and for content without sound.
 */
export const useCompoundWaveform = (content: CompoundContent | undefined): { buckets: WaveformBuckets; seconds: number } | null => {
  const [made, setMade] = useState<{ content: CompoundContent; buckets: WaveformBuckets; seconds: number } | null>(null);
  useEffect(() => {
    if (!content) return;
    let live = true;
    const timer = setTimeout(() => {
      void compoundMix(content).then(async (mix) => {
        if (!mix || !live) return;
        const buckets = await waveformOf(mix.path);
        if (buckets && live) setMade({ content, buckets, seconds: mix.seconds });
      });
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [content]);
  // The last mix stays up while a new one is made, so the band doesn't blink on every edit.
  return content && made ? { buckets: made.buckets, seconds: made.seconds } : null;
};
