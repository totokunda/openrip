// Sound while scrubbing (CapCut's Edit › Play audio while scrubbing, and Preview axis ›
// Preview video and audio): a short snippet of the mix at the frame the playhead is dragged or
// stepped to, or that the mouse skims over the timeline. The engine renders the snippets (a few
// tens of ms, faded, rate-limited, the newest replacing the last); this decides when to ask.
import { engineScrubAudio, engineScrubAudioStop } from "@app/preload";
import { useControlsStore } from "./control";
import { preferences } from "./preferences";

/** The frame last asked for, so a mouse move that stays on one frame does not repeat it. */
let lastFrame = -1;

/** A snippet at `frame`: when Edit › Play audio while scrubbing is on (the playhead moved). */
export function scrubSound(frame: number) {
  if (!preferences().scrubAudio) return;
  const { fps, isPlaying } = useControlsStore.getState();
  if (isPlaying || !fps || frame === lastFrame) return;
  lastFrame = frame;
  engineScrubAudio((frame / fps) * 1e6);
}

/** A snippet at `frame` while skimming the timeline, when the Preview axis is on "video and audio". */
export function skimSound(frame: number) {
  const { fps, isPlaying, previewAxis, previewAxisAudio } = useControlsStore.getState();
  if (!previewAxis || !previewAxisAudio || isPlaying || !fps || frame === lastFrame) return;
  lastFrame = frame;
  engineScrubAudio((frame / fps) * 1e6);
}

/** The drag (or the mouse's visit) is over: cut the snippet short. */
export function scrubSoundStop() {
  lastFrame = -1;
  engineScrubAudioStop();
}
