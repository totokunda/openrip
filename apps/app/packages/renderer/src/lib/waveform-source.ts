// Where the timeline's waveforms come from: the engine's buckets for a file (`engineWaveform`,
// decoded once and kept on disk with the thumbnails), asked once per file and session, with a
// hook for the clips that draw them. Without the engine there are no bars (the clip and its
// volume line still draw).
import { useEffect, useState } from "react";
import { engineWaveform } from "@app/preload";
import { WAVEFORM_PER_SECOND, type WaveformBuckets } from "./waveform.ts";
import { fileOf } from "./audio-tools";

const asked = new Map<string, Promise<WaveformBuckets | null>>();
const known = new Map<string, WaveformBuckets | null>();

/** A file's buckets, asked once per session (a failed ask is tried again next time). */
export const waveformOf = (path: string): Promise<WaveformBuckets | null> => {
  const file = fileOf(path);
  let p = asked.get(file);
  if (!p) {
    p = engineWaveform(file, WAVEFORM_PER_SECOND).then(
      (w) => {
        const b = w ? { perSecond: w.perSecond, rms: w.rms } : null;
        known.set(file, b);
        return b;
      },
      () => {
        asked.delete(file);
        return null;
      },
    );
    asked.set(file, p);
  }
  return p;
};

/** The buckets of the file at `path` (an asset's path), once they've come; null until then or without sound. */
export const useWaveform = (path: string | undefined): WaveformBuckets | null => {
  const file = path ? fileOf(path) : "";
  const [buckets, setBuckets] = useState<WaveformBuckets | null>(() => (file ? (known.get(file) ?? null) : null));
  useEffect(() => {
    if (!file) return setBuckets(null);
    let live = true;
    setBuckets(known.get(file) ?? null);
    void waveformOf(file).then((b) => live && setBuckets(b));
    return () => {
      live = false;
    };
  }, [file]);
  return buckets;
};
