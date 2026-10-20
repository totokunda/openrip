// A compound clip has no media file, and the tools that read one (Stabilize, Reduce image noise,
// Remove flickers, Motion blur, Normalize loudness, Reduce noise, Auto adjust, Color match) need
// one: CapCut's "Pre-process compound clip" renders the compound into one. Here that file is
// made on first use (lib/compound-render.ts), kept as an asset on the clip (`renderedAssetId`)
// with the key of the content it came from, and is stale as soon as the content changes. These
// are the small pure parts: whether it is current, and the asset the tools should read.
import { useClipStore } from "./clip";
import { allClips, isCompound, mapClips } from "./compound";
import type { AnyClipProps, Asset, CompoundContent, VideoClipProps } from "./types";

const keys = new WeakMap<CompoundContent, string>();

/** A short key for a compound's content (its clips and tracks, and the files they use), made once per content object. */
export const contentHash = (content: CompoundContent): string => {
  let k = keys.get(content);
  if (!k) {
    const assets = useClipStore.getState().assets;
    const used = [...new Set(allClips(content.clips).map((c) => (c as VideoClipProps).assetId).filter(Boolean))].sort();
    const text = JSON.stringify(content) + used.map((id) => `|${id}=${assets[id]?.path ?? ""}`).join("");
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    k = `${(h >>> 0).toString(36)}-${text.length}`;
    keys.set(content, k);
  }
  return k;
};

/** Whether the clip needs its rendered file now: a clean-up part or an audio tool of the compound's own is on. */
export const needsRender = (clip: AnyClipProps | undefined): boolean => {
  if (!isCompound(clip)) return false;
  const e = (clip as VideoClipProps).enhance;
  const c = clip as VideoClipProps & { loudness?: { enabled?: boolean } | null; denoise?: { enabled?: boolean } | null };
  return !!(e && (e.stabilize || e.denoise || e.deflicker || e.motionBlur)) || !!c.loudness?.enabled || !!c.denoise?.enabled;
};

/** Whether the compound's rendered file is there and made from the content as it is. */
export const renderedValid = (clip: AnyClipProps | undefined): clip is VideoClipProps & { compound: CompoundContent; renderedAssetId: string } => {
  if (!isCompound(clip)) return false;
  const c = clip as VideoClipProps;
  return !!c.renderedAssetId && c.renderedKey === contentHash(c.compound!) && !!useClipStore.getState().assets[c.renderedAssetId];
};

/** The asset a media tool reads for a clip: its own media, or a compound's rendered file when it's current ("" otherwise). */
export const mediaAssetId = (clip: AnyClipProps | undefined): string => {
  const own = (clip as { assetId?: string } | undefined)?.assetId;
  if (own) return own;
  return renderedValid(clip) ? (clip as VideoClipProps).renderedAssetId! : "";
};

/** [`mediaAssetId`]'s asset. */
export const mediaAssetOf = (clip: AnyClipProps | undefined): Asset | undefined => {
  const id = mediaAssetId(clip);
  return id ? useClipStore.getState().assets[id] : undefined;
};

/** The compound clip with `clipId` in the timeline being edited, inside one, or in a timeline left open to edit one (deep). */
export const findCompound = (clipId: string): VideoClipProps | undefined => {
  const { clips, compoundStack } = useClipStore.getState();
  const hit = allClips([...clips, ...compoundStack.flatMap((f) => f.clips)]).find((c) => c.clipId === clipId);
  return isCompound(hit) ? (hit as VideoClipProps) : undefined;
};

/**
 * Set fields on the compound clip `clipId` wherever it is (the timeline being edited, inside a
 * compound, or a timeline left open), without a history step: for what is a cache of the content.
 */
export const patchCompound = (clipId: string, patch: Partial<VideoClipProps>) => {
  const fn = (c: AnyClipProps) => (c.clipId === clipId ? ({ ...c, ...patch } as AnyClipProps) : c);
  const { clips, compoundStack } = useClipStore.getState();
  useClipStore.setState({ clips: mapClips(clips, fn), compoundStack: compoundStack.map((f) => ({ ...f, clips: mapClips(f.clips, fn) })) });
};
