import React from "react";
import { Rect } from "react-konva";
import type { AnyClipProps, AudioClipProps } from "@/lib/types";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { mainTrackOf } from "@/lib/timeline-edit";
import { fileOf } from "@/lib/audio-tools";
import { useWaveform } from "@/lib/waveform-source";
import { AUDIO_SCALE, BAND_SCALE, SOUND_COLORS, mediaBands, scaleFor, soundKindOf } from "@/lib/waveform";
import { ClipChips, Waveform } from "./Waveform";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";

/**
 * Audio and media clips' faces on the timeline, as CapCut's (docs/plan/capcut-ui-spec.md §4.11):
 * an audio clip is its kind's colour with its waveform rising from the bottom and its name chip
 * at the top left; a video or photo has a label band (name and length chips), its thumbnails,
 * and a bottom band with its own sound's waveform (empty for a photo, or a video whose sound was
 * detached). The track's "…" menu sets the waveform's size and the track's height. The body and
 * band rects take the clip's clicks and drags (its group has no hit area but its children's).
 */

const VIDEO_BODY = TIMELINE_COLORS.video;
const VIDEO_CHIP = TIMELINE_COLORS.videoChip;
/** The default heights the waveforms' scale is measured at: an audio clip, a main and an overlay video's bands. */
const AUDIO_HEIGHT = 50;

/** "HH:MM:SS:FF", as CapCut's length chip. */
const timecode = (frames: number, fps: number) => {
  const f = Math.max(0, Math.round(frames));
  const r = Math.max(1, Math.round(fps));
  const s = Math.floor(f / r);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f % r)}`;
};

/** A path's file name (without a detach's `#audio`/`#video`). */
const nameOf = (path: string | undefined) => {
  const file = fileOf(path);
  try {
    return decodeURIComponent(file.split("/").pop() ?? "");
  } catch {
    return file.split("/").pop() ?? "";
  }
};

/** The track's waveform size and whether it's the main track. */
const useTrack = (timelineId: string) => {
  const size = useClipStore((s) => s.timelines.find((t) => t.timelineId === timelineId)?.waveform ?? 30);
  const main = useClipStore((s) => mainTrackOf(s.timelines)?.timelineId === timelineId);
  return { size, main };
};

/** A media clip's bands on its track (null for other clips): where its thumbnails go. */
export const useMediaBands = (clipType: string, timelineId: string, height: number) => {
  const { main } = useTrack(timelineId);
  return clipType === "video" || clipType === "image" ? mediaBands(height, main) : null;
};

type FaceProps = {
  clip: AnyClipProps;
  timelineId: string;
  width: number;
  height: number;
  /** The part of the clip on screen, px from its left edge. */
  fromPx: number;
  toPx: number;
  snap: number;
  cornerRadius: number;
};

/** An audio clip: its kind's colour, its waveform over the whole clip, its name chip. */
export const SoundClipFace: React.FC<FaceProps> = ({ clip, timelineId, width, height, fromPx, toPx, snap, cornerRadius }) => {
  const asset = useClipStore((s) => s.assets[(clip as AudioClipProps).assetId]);
  const fps = useControlsStore((s) => s.fps) || 30;
  const { size } = useTrack(timelineId);
  const buckets = useWaveform(asset?.path);
  const colors = SOUND_COLORS[soundKindOf(asset)];
  const len = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
  return (
    <>
      <Rect width={width} height={height} cornerRadius={cornerRadius} fill={colors.body} />
      {buckets && (
        <Waveform
          clip={clip}
          buckets={buckets}
          fps={fps}
          mediaSeconds={asset?.duration || undefined}
          pxPerFrame={width / len}
          fromPx={fromPx}
          toPx={toPx}
          y={0}
          height={height}
          scale={scaleFor(AUDIO_SCALE, height, AUDIO_HEIGHT, size)}
          color={colors.bar}
          snap={snap}
        />
      )}
      <ClipChips texts={[nameOf(asset?.path).replace(/\.[^.]+$/, "")]} fill={colors.chip} maxWidth={width} clipId={clip.clipId} />
    </>
  );
};

/**
 * A video's or photo's bands around its thumbnails (which the clip draws in between): the label
 * band with its name and length, the bottom band with its own sound.
 */
export const MediaBandsFace: React.FC<FaceProps & { bands: { label: number; thumbs: number; sound: number } }> = ({
  clip,
  timelineId,
  width,
  height,
  fromPx,
  toPx,
  snap,
  bands,
}) => {
  const asset = useClipStore((s) => s.assets[(clip as AudioClipProps).assetId]);
  const fps = useControlsStore((s) => s.fps) || 30;
  const { size } = useTrack(timelineId);
  // A photo has no sound; a video whose sound was detached plays none of its own (CapCut's empty band).
  const own = clip.type === "video" && !!asset && !asset.path.endsWith("#video");
  const buckets = useWaveform(own ? asset?.path : undefined);
  const len = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
  const top = height - bands.sound;
  return (
    <>
      <Rect width={width} height={bands.label} fill={VIDEO_BODY} />
      <Rect y={top} width={width} height={bands.sound} fill={VIDEO_BODY} />
      {buckets && bands.sound > 0 && (
        <Waveform
          clip={clip}
          buckets={buckets}
          fps={fps}
          mediaSeconds={asset?.duration || undefined}
          pxPerFrame={width / len}
          fromPx={fromPx}
          toPx={toPx}
          y={top}
          height={bands.sound}
          scale={scaleFor(BAND_SCALE, bands.sound, 16, size)}
          color={TIMELINE_COLORS.fromVideoWave}
          snap={snap}
        />
      )}
      <ClipChips texts={[nameOf(asset?.path), timecode(len, fps)]} fill={VIDEO_CHIP} maxWidth={width} clipId={clip.clipId} />
    </>
  );
};
