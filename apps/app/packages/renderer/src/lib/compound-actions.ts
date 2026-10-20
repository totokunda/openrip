// What a compound clip's menu does with its sound: Transcript and Extract audio read the compound's
// mix (everything in its timeline, mixed by the engine: lib/compound-mix.ts), the way they read a
// video's media file. The mix is kept as an asset (an audio file in the app's data folder) on the
// compound clip (`mixAssetId`), so a transcript heard from it is kept with it like a video's.
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { beginStep } from "./history";
import { compoundMix } from "./compound-mix";
import { isCompound } from "./compound";
import { openTranscript } from "./transcript";
import { getTimelineHeightForClip } from "./clip";
import type { AnyClipProps, AudioClipProps, VideoClipProps } from "./types";

/** A file's path as the URL assets are kept by. */
const urlOf = (path: string) => encodeURI(`file://${path}`).replace(/#/g, "%23").replace(/\?/g, "%3F");

/**
 * The compound clip's mix as an asset on the clip: mixes the content (once per content; a moment
 * the first time) and keeps it. Null (with a note) when the compound has no sound.
 */
export async function compoundSoundAsset(clipId: string): Promise<string | null> {
  const clip = useClipStore.getState().getClipById(clipId);
  if (!isCompound(clip)) return null;
  const mix = await compoundMix(clip.compound);
  if (!mix) {
    toast("This compound clip has no sound");
    return null;
  }
  const store = useClipStore.getState();
  const asset = store.addAsset({ path: urlOf(mix.path), type: "audio", duration: mix.seconds });
  const now = store.getClipById(clipId);
  if (now && (now as VideoClipProps).mixAssetId !== asset.id) store.updateClip(clipId, { mixAssetId: asset.id } as Partial<AnyClipProps>);
  return asset.id;
}

/** The clip menu's Transcript on a compound: its sound is mixed, then the panel opens on it. */
export async function openCompoundTranscript(clipId: string) {
  if (!(await compoundSoundAsset(clipId))) return;
  openTranscript(clipId);
}

/**
 * Extract audio on a compound: its mix becomes an audio clip on a new audio track under it
 * (linked to it, with its span, trim, speed and volume), and the compound plays none of its own.
 * One undo step.
 */
export async function extractCompoundAudio(clipId: string): Promise<boolean> {
  const first = useClipStore.getState().getClipById(clipId);
  if (!isCompound(first) || first.audioSeparated) return false;
  const assetId = await compoundSoundAsset(clipId);
  const clip = useClipStore.getState().getClipById(clipId);
  if (!assetId || !isCompound(clip)) return false;
  beginStep();
  const store = useClipStore.getState();
  const timelineId = uuidv4();
  const index = store.timelines.findIndex((t) => t.timelineId === clip.timelineId);
  store.addTimeline({ timelineId, type: "audio", timelineHeight: getTimelineHeightForClip("audio") }, index === -1 ? undefined : index);
  const linkId = clip.linkId ?? uuidv4();
  const audio = { ...clip, type: "audio", assetId, clipId: uuidv4(), timelineId, linkId } as unknown as AudioClipProps & Record<string, unknown>;
  for (const key of ["compound", "name", "mixAssetId", "audioSeparated"]) delete audio[key];
  store.addClip(audio as AnyClipProps);
  store.updateClip(clipId, { audioSeparated: true, linkId } as Partial<AnyClipProps>);
  useControlsStore.getState().setSelectedClipIds([audio.clipId as string]);
  return true;
}
