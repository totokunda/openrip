import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The player's view settings, kept between sessions: the preview's quality (the engine
 * renders paused frames and playback at this fraction of the canvas's size on screen, as
 * CapCut's Full / Half / Quarter) and the safe-area guides.
 */
export type PreviewQuality = 1 | 0.5 | 0.25;

interface PlayerState {
  quality: PreviewQuality;
  setQuality: (quality: PreviewQuality) => void;
  guides: boolean;
  setGuides: (on: boolean) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      quality: 1,
      setQuality: (quality) => set({ quality }),
      guides: false,
      setGuides: (guides) => set({ guides }),
    }),
    { name: "openrip:player" },
  ),
);
