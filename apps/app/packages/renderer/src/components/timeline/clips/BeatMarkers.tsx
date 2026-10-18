import React, { useEffect, useMemo, useState } from "react";
import { Circle, Group } from "react-konva";
import type { AnyClipProps, AudioClipProps } from "@/lib/types";
import { useControlsStore } from "@/lib/control";
import { beatFrames } from "@/lib/beats";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";
import { fetchBeatGrid, knownBeatGrid, mediaSecondsOf } from "@/lib/audio-tools";

/** The markers' colour (lib/timeline-colors.ts): CapCut's beat dots are yellow whatever the clip's colour. */
export const BEAT_COLOR = TIMELINE_COLORS.beat;

/**
 * A clip's beat markers (lib/beats.ts), as CapCut draws them on music: a small yellow dot near
 * the clip's bottom edge at each beat, hand-marked and automatic alike, placed through the
 * clip's trim, speed and direction. Drawn inside the clip's own group (its x is the clip's
 * left); the engine's beats for its file are asked for once Auto beat is on.
 */
const BeatMarkers: React.FC<{ clip: AnyClipProps; width: number; height: number }> = ({ clip, width, height }) => {
  const fps = useControlsStore((s) => s.fps) || 30;
  const beats = (clip as AudioClipProps).beats;
  const wantsGrid = !!beats?.auto && !beats.detected?.length;
  const [grid, setGrid] = useState(() => (wantsGrid ? knownBeatGrid(clip) : null));
  const assetId = (clip as AudioClipProps).assetId;

  useEffect(() => {
    if (!wantsGrid) return;
    let live = true;
    void fetchBeatGrid(clip).then((g) => live && setGrid(g));
    return () => {
      live = false;
    };
  }, [wantsGrid, assetId]);

  const xs = useMemo(() => {
    if (!beats) return [];
    const start = clip.startFrame ?? 0;
    const span = Math.max(1, (clip.endFrame ?? 0) - start);
    return beatFrames(clip, fps, wantsGrid ? grid : null, mediaSecondsOf(clip)).map((f) => ((f - start) / span) * width);
  }, [clip, beats, grid, wantsGrid, width, fps]);

  if (xs.length === 0) return null;
  // Too dense to tell apart (zoomed far out): every other one, as the ruler drops ticks.
  const step = Math.max(1, Math.ceil(6 / Math.max(0.001, width / xs.length)));
  return (
    <Group listening={false} name="beat-markers">
      {xs
        .filter((_, i) => i % step === 0)
        .map((x, i) => (
          <Circle key={i} x={x} y={height - 5} radius={2.5} fill={BEAT_COLOR} stroke="rgba(0,0,0,0.45)" strokeWidth={0.75} />
        ))}
    </Group>
  );
};

export default BeatMarkers;
